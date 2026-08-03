import { decryptField, encryptField, isEncryptedField } from "@billow/crypto";

import { getPrisma } from "./index";

/**
 * The encrypted-field list. Adding a field here is the entire change — no call
 * site is touched, and no query has to remember anything.
 *
 * That is the point of doing this as a Prisma client extension rather than at
 * each call site: call-site crypto is where these designs leak, because one
 * forgotten query writes plaintext into a column everything else believes is
 * encrypted, and nothing notices until someone reads the table.
 *
 * What cannot go here, and why:
 *
 * - Anything needed before a data key exists (`user.email`, `username`) —
 *   sign-in has to find the row before it can open the key.
 * - Anything under a unique constraint or used for ordering
 *   (`Invoice.invoiceNumber`) — ciphertext differs on every write, so
 *   uniqueness and sorting stop meaning anything.
 * - Foreign keys, timestamps, and installation config.
 *
 * And the standing cost: an encrypted column cannot be searched or sorted in
 * SQL, and a list view cannot render one without the signed-in user's key.
 */
export const ENCRYPTED_FIELDS: Record<string, readonly string[]> = {
  BankAccount: [
    "accountNumber",
    "iban",
    "clabe",
    "swift",
    "routingNumber",
    "institutionNumber",
    "transitNumber",
    "accountHolderName",
    "accountHolderAddress",
  ],
  UserProfile: ["taxId", "address"],
};

/** Prisma passes model names capitalised in `$allOperations`. */
function fieldsFor(model: string | undefined): readonly string[] {
  return (model && ENCRYPTED_FIELDS[model]) || [];
}

function sealWrite(model: string, fields: readonly string[], dataKey: Buffer, data: unknown) {
  if (!data || typeof data !== "object") return data;
  const record = data as Record<string, unknown>;

  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) continue;
    // Never double-encrypt: an update that echoes a value straight back from a
    // read would otherwise wrap it twice and lose the plaintext on the way out.
    if (isEncryptedField(value)) continue;
    record[field] = encryptField(dataKey, `${model}.${field}`, value);
  }

  return record;
}

function openRead(model: string, fields: readonly string[], dataKey: Buffer, row: unknown): unknown {
  if (!row || typeof row !== "object") return row;
  if (Array.isArray(row)) return row.map((item) => openRead(model, fields, dataKey, item));
  const record = row as Record<string, unknown>;

  for (const field of fields) {
    const value = record[field];
    // Plaintext written before this shipped stays readable as itself. Enabling
    // encryption must not make existing rows unreadable.
    if (!isEncryptedField(value)) continue;
    try {
      record[field] = decryptField(dataKey, `${model}.${field}`, value);
    } catch {
      // Wrong key, or a value tampered with. Report it as absent rather than
      // throwing: one unreadable column should not take down the page, and a
      // blank field is an honest description of what the caller can see.
      record[field] = null;
    }
  }

  return record;
}

/**
 * A Prisma client that transparently encrypts and decrypts the listed fields
 * with one user's data key.
 *
 * Built per request rather than once at startup, because the key belongs to a
 * session and not to the process — the server never holds a usable data key
 * outside a request that carries the cookie for it.
 *
 * Callers with no data key (an API-key caller, or a session predating the
 * keyset) must use the plain client and treat encrypted columns as
 * unavailable. That is deliberate: a key stored in a script is not the
 * signed-in user, and silently decrypting for one would defeat the design.
 */
export function encryptedPrisma(dataKey: Buffer) {
  return getPrisma().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const fields = fieldsFor(model);
          if (fields.length === 0) return query(args);

          const input = args as Record<string, unknown>;
          if (input && typeof input === "object") {
            if ("data" in input) {
              const data = input["data"];
              input["data"] = Array.isArray(data)
                ? data.map((item) => sealWrite(model!, fields, dataKey, item))
                : sealWrite(model!, fields, dataKey, data);
            }
            // upsert carries both halves.
            for (const half of ["create", "update"] as const) {
              if (half in input) input[half] = sealWrite(model!, fields, dataKey, input[half]);
            }
          }

          const result = await query(args);
          // Counts and aggregates come back as numbers; leave them alone.
          if (operation.startsWith("count") || operation.startsWith("aggregate")) return result;

          return openRead(model!, fields, dataKey, result);
        },
      },
    },
  });
}

/**
 * Encrypts a user's existing plaintext rows.
 *
 * There is no deploy-time migration for this and there cannot be: the server
 * holds no data keys, so rows can only be sealed while their owner is signed
 * in. Sign-in is the one moment both the key and the user are present, so the
 * backfill runs there.
 *
 * Idempotent — a row whose listed fields are already sealed is skipped, so
 * once a user is migrated this costs one indexed read per sign-in.
 */
export async function backfillEncryptedFields(userId: string, dataKey: Buffer): Promise<number> {
  const plain = getPrisma();
  const sealed = encryptedPrisma(dataKey);
  let migrated = 0;

  const pending = (row: Record<string, unknown>, fields: readonly string[]) =>
    fields.filter((field) => typeof row[field] === "string" && !isEncryptedField(row[field]));

  for (const profile of await plain.userProfile.findMany({ where: { userId } })) {
    const row = profile as unknown as Record<string, unknown>;
    const fields = pending(row, ENCRYPTED_FIELDS["UserProfile"]!);
    if (fields.length === 0) continue;
    await sealed.userProfile.update({
      where: { id: profile.id },
      data: Object.fromEntries(fields.map((field) => [field, row[field]])),
    });
    migrated += 1;
  }

  for (const account of await plain.bankAccount.findMany({ where: { userProfile: { userId } } })) {
    const row = account as unknown as Record<string, unknown>;
    const fields = pending(row, ENCRYPTED_FIELDS["BankAccount"]!);
    if (fields.length === 0) continue;
    await sealed.bankAccount.update({
      where: { id: account.id },
      data: Object.fromEntries(fields.map((field) => [field, row[field]])),
    });
    migrated += 1;
  }

  return migrated;
}
