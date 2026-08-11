import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { createEncryptedWriteGuardExtension } from "./encrypted-write-guard";

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

function guardEncryptedWrites(client: ExtendedPrismaClient) {
  return client.$extends(createEncryptedWriteGuardExtension());
}

export type GuardedPrismaClient = ReturnType<typeof guardEncryptedWrites>;

const globalForPrisma = globalThis as unknown as {
  prisma?: ExtendedPrismaClient;
  guardedPrisma?: GuardedPrismaClient;
};

/**
 * The client without the plaintext-write guard. **Not for general use** — the
 * only sanctioned caller is `field-encryption.ts`, which builds the sealing
 * client on top of it.
 *
 * It has to exist, and it has to be reachable from that one module, because
 * Prisma runs the first-applied extension first: a guard applied here would
 * run before the sealer above it and reject the very writes the sealer is
 * about to encrypt. So the sealing client starts from an unguarded base and
 * runs the check itself, after sealing.
 *
 * It is not reachable from outside this package — `package.json` exports only
 * `.`, `./client`, `./enums`, and `./field-encryption`, so no deep import can
 * pick it up — and `encrypted-writes.test.ts` fails the build if a file
 * outside the mechanism names it.
 */
export function getUnguardedPrisma(): ExtendedPrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}

/**
 * The application's Prisma client.
 *
 * It refuses to write plaintext into a column listed in `ENCRYPTED_FIELDS`,
 * throwing `PlaintextEncryptedWriteError` before anything is sent to Postgres.
 * Reads, deletes, and every unlisted column are untouched — what a caller
 * without a data key loses is only the ability to store a value the rest of
 * the system believes is encrypted. Those writes belong on
 * `getWorkspacePrisma()`.
 *
 * The guard lives here, on the client the whole repository imports, rather
 * than only on the encrypted client, because that was the actual hole: the
 * mechanism was opt-in per client, so it protected exactly the call sites that
 * had already remembered to opt in.
 *
 * Wraps the same cached base client, so this adds a proxy and not a second
 * connection pool.
 */
export function getPrisma(): GuardedPrismaClient {
  if (!globalForPrisma.guardedPrisma) {
    globalForPrisma.guardedPrisma = guardEncryptedWrites(getUnguardedPrisma());
  }

  return globalForPrisma.guardedPrisma;
}
