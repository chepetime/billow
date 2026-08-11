import { describe, expect, it, vi } from "vitest";

import {
  createEncryptedWriteGuardExtension,
  PlaintextEncryptedWriteError,
} from "./encrypted-write-guard";
import { encryptedPrisma, sealEncryptedFields } from "./field-encryption";
import { getPrisma, getUnguardedPrisma } from "./index";

const DATA_KEY = Buffer.alloc(32, 7);

/**
 * Invokes the extension's $allOperations hook the same way Prisma's query
 * engine does: pass the operation name and a `query` stand-in for the actual
 * database call.
 */
function runAllOperations(
  operation: string,
  args: unknown,
  query: (args: unknown) => Promise<unknown> = async () => "row",
) {
  const extension = createEncryptedWriteGuardExtension();
  return extension.query.$allModels.$allOperations({ operation, args, query });
}

describe("createEncryptedWriteGuardExtension", () => {
  it("refuses a plaintext write without sending it to the database", async () => {
    const query = vi.fn();

    await expect(
      runAllOperations(
        "create",
        { data: { label: "Primary", accountNumber: "4444555566" } },
        query,
      ),
    ).rejects.toThrow(PlaintextEncryptedWriteError);
    // The point of refusing rather than failing: nothing reached Postgres.
    expect(query).not.toHaveBeenCalled();
  });

  it("passes a sealed write through untouched", async () => {
    const data = sealEncryptedFields("BankAccount", DATA_KEY, {
      label: "Primary",
      accountNumber: "4444555566",
    });
    const query = vi.fn().mockResolvedValue("created-row");

    await expect(runAllOperations("create", { data }, query)).resolves.toBe(
      "created-row",
    );
    expect(query).toHaveBeenCalledWith({ data });
  });

  it("leaves reads and unencrypted writes alone", async () => {
    const query = vi.fn().mockResolvedValue("rows");

    await expect(
      runAllOperations("findMany", { where: { accountNumber: "444" } }, query),
    ).resolves.toBe("rows");
    await expect(
      runAllOperations("updateMany", { data: { isDefault: false } }, query),
    ).resolves.toBe("rows");
    expect(query).toHaveBeenCalledTimes(2);
  });
});

/**
 * These run against real Prisma clients, with a connection string pointing at
 * nothing. That is enough, and it is the point: both assertions are settled
 * before a socket is opened, so the guard's placement can be checked without a
 * database.
 *
 * What they pin down is the ordering assumption the whole arrangement rests
 * on. Prisma runs the *first*-applied extension first, so the guard cannot be
 * applied inside `createPrismaClient()` — it would run ahead of the sealer
 * stacked on top of it and reject every encrypted write in the app. Get that
 * backwards and the second test below fails, which is the only cheap way to
 * find out.
 */
describe("where the guard sits", () => {
  const UNREACHABLE = "postgresql://billow:billow@127.0.0.1:1/billow";

  function withDatabaseUrl<T>(run: () => T): T {
    const previous = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = UNREACHABLE;
    try {
      return run();
    } finally {
      if (previous === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = previous;
    }
  }

  it("getPrisma() refuses a plaintext write to an encrypted column", async () => {
    const prisma = withDatabaseUrl(() => getPrisma());

    await expect(
      prisma.bankAccount.create({
        data: { userProfileId: 1, label: "Primary", accountNumber: "4444" },
      }),
    ).rejects.toThrow(PlaintextEncryptedWriteError);
  });

  it("encryptedPrisma() seals first, so its writes are never refused", async () => {
    const prisma = withDatabaseUrl(() => encryptedPrisma(DATA_KEY));

    // Reaches the adapter and fails to connect, which is the pass condition:
    // the write got past the guard because the sealer ran ahead of it.
    await expect(
      prisma.bankAccount.create({
        data: { userProfileId: 1, label: "Primary", accountNumber: "4444" },
      }),
    ).rejects.not.toThrow(PlaintextEncryptedWriteError);
  });

  it("hands out one connection pool for both clients", () => {
    // The guarded client is a proxy over the cached base, not a second pool.
    // A per-request `$extends` that opened its own would exhaust Postgres.
    const base = withDatabaseUrl(() => getUnguardedPrisma());
    expect(withDatabaseUrl(() => getUnguardedPrisma())).toBe(base);
    expect(withDatabaseUrl(() => getPrisma())).toBe(
      withDatabaseUrl(() => getPrisma()),
    );
  });
});
