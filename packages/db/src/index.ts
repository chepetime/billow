import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

export type { PrismaClient } from "../generated/prisma/client";
export * from "../generated/prisma/enums";

export function createPrismaClient() {
  const connectionString =
    process.env.DATABASE_URL ||
    (process.env.NEXT_PHASE === "phase-production-build"
      ? "postgresql://billow:billow-password@localhost:5432/billow"
      : undefined);

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to connect to Postgres.");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getPrisma() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}
