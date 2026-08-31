import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

export type { PrismaClient } from "../generated/prisma/client";
export * from "../generated/prisma/enums";

// Prisma error codes for connection-level failures that are safe to retry.
// Deliberately excludes P1000 (authentication failed): bad credentials are a
// configuration problem, and retrying them only delays the report and hides
// the cause. Let those surface immediately on /health.
const TRANSIENT_PRISMA_CODES = new Set(["P1001", "P1002", "P1017"]);

function isTransientConnectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_PRISMA_CODES.has(code)) {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /ECONNRESET|ETIMEDOUT|EPIPE|Connection terminated|connection closed|server closed the connection|Can't reach database server|Timed out fetching a new connection/i.test(
      message,
    )
  );
}

/**
 * Is this a Prisma unique-constraint violation (P2002)?
 *
 * Duck-typed on `code`, never `instanceof
 * Prisma.PrismaClientKnownRequestError`, for the same reason
 * `isTransientConnectionError` above is. The check has to hold in the
 * production bundle, and there it does not: Next splits the generated client
 * and the `Prisma` namespace an importing module names into different server
 * chunks, so the class the error is constructed from is not the class the
 * `instanceof` compares against and every such test is silently false.
 *
 * That failure is invisible in dev and in vitest, where the module graph is
 * loaded once and both sides are the same object. It cost a released version
 * in which no second account could be created at all: the P2002 that
 * `claimFoundingOwner` exists to swallow escaped instead, and sign-up
 * answered 500.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// Operations where re-issuing the query after a dropped connection cannot
// change what the database observed: no matter which side of the round trip
// the connection failed on, nothing was written, so retrying is exactly
// equivalent to trying once. $queryRaw/$queryRawUnsafe belong here because
// they are reads; $executeRaw/$executeRawUnsafe deliberately do not, because
// they run arbitrary SQL that may mutate. Anything not in this set — create,
// update, delete, upsert, createMany, executeRaw, and any future mutation —
// is retried zero times: a connection reset after the database already
// committed and only the response was lost is retried transparently, which
// silently replays the write (see AUDIT-CODEX.md item 2, and the upload
// path, where a replayed insert collides with the file already written under
// the first attempt's storage key).
const RETRYABLE_READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "$queryRaw",
  "$queryRawUnsafe",
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Extracted from createPrismaClient so the retry/no-retry decision can be
// exercised directly in tests against a fake `query`, without constructing a
// real PrismaClient or reaching a database.
export function createRetryExtension() {
  return {
    name: "retry-transient-connection",
    query: {
      async $allOperations({
        operation,
        args,
        query,
      }: {
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) {
        const maxAttempts = RETRYABLE_READ_OPERATIONS.has(operation) ? 3 : 1;
        for (let attempt = 1; ; attempt++) {
          try {
            return await query(args);
          } catch (error) {
            if (attempt < maxAttempts && isTransientConnectionError(error)) {
              await sleep(attempt * 100);
              continue;
            }
            throw error;
          }
        }
      },
    },
  };
}

export function createPrismaClient() {
  const connectionString =
    process.env.DATABASE_URL ||
    (process.env.NEXT_PHASE === "phase-production-build"
      ? "postgresql://billow:billow-password@localhost:5432/billow"
      : undefined);

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to connect to Postgres.");
  }

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString, keepAlive: true }),
  });

  // A pooled connection can be closed server-side (idle drop, brief network
  // blip) while the pool still hands it out, so the first query on it fails
  // and only a retry — which acquires a fresh connection — succeeds. That is
  // safe to redo transparently for reads (see RETRYABLE_READ_OPERATIONS
  // above), including the ones BetterAuth issues through this same client.
  // Mutations get one attempt: a connection error on a mutation is ambiguous
  // rather than safe to replay, so it is left to propagate through the
  // normal error path instead of being retried here.
  //
  // This is unrelated to first-boot readiness: `apps/web/scripts/start.sh`
  // runs `prisma migrate deploy` as its own CLI process, with its own
  // retry-while-Postgres-comes-up loop, before this client is ever
  // constructed. Nothing here needs to cover that window.
  return client.$extends(createRetryExtension());
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma?: ExtendedPrismaClient;
};

export function getPrisma(): ExtendedPrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}
