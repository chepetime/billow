import { encryptField } from "@billow/crypto";
import { describe, expect, it } from "vitest";

import {
  createEncryptedExtension,
  createGuardedExtension,
  ENCRYPTED_FIELDS,
  PlaintextEncryptedWriteError,
} from "./field-encryption";

const DATA_KEY = Buffer.alloc(32, 7);

/**
 * Invokes the extension's $allOperations hook the same way Prisma's query
 * engine does: pass the model, operation name, args, and a `query` stand-in
 * for the actual database call. Mirrors runAllOperations in index.test.ts.
 */
function runAllOperations(
  extension: ReturnType<typeof createEncryptedExtension>,
  model: string,
  operation: string,
  args: unknown,
  query: (args: unknown) => Promise<unknown>,
) {
  return extension.query.$allModels.$allOperations({
    model,
    operation,
    args,
    query,
  });
}

describe("createEncryptedExtension", () => {
  it("decrypts an encrypted field nested under an include, not just the queried model's own fields", async () => {
    // What Postgres actually holds: real ciphertext, sealed the same way a
    // write through this same extension would seal it.
    const sealedTaxId = encryptField(DATA_KEY, "UserProfile.taxId", "RFC123");
    const sealedAccountNumber = encryptField(
      DATA_KEY,
      "BankAccount.accountNumber",
      "0011223344",
    );

    const extension = createEncryptedExtension(DATA_KEY);

    // `invoice.findFirst({ include: { userProfile, bankAccount } })` reports
    // "Invoice" as the model — which has no encrypted fields of its own. The
    // bug this pins down: a decrypt keyed only on the queried model's field
    // list never reaches the included relations at all.
    const result = await runAllOperations(
      extension,
      "Invoice",
      "findFirst",
      { where: { id: 1 } },
      async () => ({
        id: 1,
        userProfile: { taxId: sealedTaxId },
        bankAccount: { accountNumber: sealedAccountNumber },
        clientCompany: { name: "Acme Co" },
      }),
    );

    expect(result).toMatchObject({
      userProfile: { taxId: "RFC123" },
      bankAccount: { accountNumber: "0011223344" },
      clientCompany: { name: "Acme Co" },
    });
  });

  it("decrypts an encrypted field nested inside an array of includes", async () => {
    const sealedAccountNumber = encryptField(
      DATA_KEY,
      "BankAccount.accountNumber",
      "0099887766",
    );
    const extension = createEncryptedExtension(DATA_KEY);

    const result = await runAllOperations(
      extension,
      "UserProfile",
      "findMany",
      {},
      async () => [
        { id: 1, bankAccounts: [{ accountNumber: sealedAccountNumber }] },
      ],
    );

    expect(result).toMatchObject([
      { bankAccounts: [{ accountNumber: "0099887766" }] },
    ]);
  });

  it("reports a field it cannot decrypt as null instead of leaking ciphertext or throwing", async () => {
    const wrongKey = Buffer.alloc(32, 9);
    const sealedUnderWrongKey = encryptField(
      wrongKey,
      "UserProfile.taxId",
      "RFC123",
    );
    const extension = createEncryptedExtension(DATA_KEY);

    const result = await runAllOperations(
      extension,
      "Invoice",
      "findFirst",
      {},
      async () => ({ userProfile: { taxId: sealedUnderWrongKey } }),
    );

    expect(result).toMatchObject({ userProfile: { taxId: null } });
  });

  it("leaves a value that was never encrypted (pre-encryption plaintext) untouched", async () => {
    const extension = createEncryptedExtension(DATA_KEY);

    const result = await runAllOperations(
      extension,
      "Invoice",
      "findFirst",
      {},
      async () => ({ userProfile: { taxId: "already-plaintext" } }),
    );

    expect(result).toMatchObject({
      userProfile: { taxId: "already-plaintext" },
    });
  });

  it("does not decrypt counts or aggregates", async () => {
    const extension = createEncryptedExtension(DATA_KEY);

    const result = await runAllOperations(
      extension,
      "Invoice",
      "count",
      {},
      async () => 3,
    );

    expect(result).toBe(3);
  });
});

describe("createGuardedExtension", () => {
  it("still rejects a plaintext write to an encrypted column with no data key", async () => {
    const extension = createGuardedExtension();

    await expect(
      runAllOperations(
        extension as unknown as ReturnType<typeof createEncryptedExtension>,
        "UserProfile",
        "create",
        { data: { taxId: "plaintext-rfc" } },
        async () => ({}),
      ),
    ).rejects.toBeInstanceOf(PlaintextEncryptedWriteError);
  });

  it("still allows a read through with ciphertext untouched", async () => {
    const extension = createGuardedExtension();
    const sealed = encryptField(DATA_KEY, "UserProfile.taxId", "RFC123");

    const result = await runAllOperations(
      extension as unknown as ReturnType<typeof createEncryptedExtension>,
      "UserProfile",
      "findFirst",
      {},
      async () => ({ taxId: sealed }),
    );

    expect(result).toMatchObject({ taxId: sealed });
  });
});

describe("ENCRYPTED_FIELDS", () => {
  it("keeps field names unique across models, the invariant openRead's key-only lookup depends on", () => {
    const seen = new Set<string>();
    for (const fields of Object.values(ENCRYPTED_FIELDS)) {
      for (const field of fields) {
        expect(seen.has(field)).toBe(false);
        seen.add(field);
      }
    }
  });
});
