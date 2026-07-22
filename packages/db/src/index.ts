import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

export type { PrismaClient } from "../generated/prisma/client";
export * from "../generated/prisma/enums";

// Prisma error codes for connection-level failures that are safe to retry.
const TRANSIENT_PRISMA_CODES = new Set(["P1000", "P1001", "P1002", "P1017"]);

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  // and only a retry — which acquires a fresh connection — succeeds. Retry
  // those transient failures transparently for every query, including the
  // ones BetterAuth issues through this same client.
  return client.$extends({
    name: "retry-transient-connection",
    query: {
      async $allOperations({ args, query }) {
        const maxAttempts = 3;
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
  });
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
