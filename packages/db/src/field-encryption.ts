import { decryptField, encryptField, isEncryptedField } from "@billow/crypto";

import {
  assertEncryptedFieldsSealed,
  ENCRYPTED_FIELDS,
} from "./encrypted-write-guard";
import { getUnguardedPrisma } from "./index";

/**
 * The field list and the guard live in `encrypted-write-guard.ts` so
 * `src/index.ts` can apply the guard to `getPrisma()` without importing this
 * module, which imports it back. Re-exported here because
 * `@billow/db/field-encryption` is the documented entry point for both.
 */
export {
  assertEncryptedFieldsSealed,
  ENCRYPTED_FIELDS,
  PlaintextEncryptedWriteError,
} from "./encrypted-write-guard";

/** Prisma passes model names capitalised in `$allOperations`. */
function fieldsFor(model: string | undefined): readonly string[] {
  return (model && ENCRYPTED_FIELDS[model]) || [];
}

/**
 * Encrypts the listed fields of one write payload, in place.
 *
 * Exported because it is the whole mechanism: the extension below is a thin
 * wrapper around it, and a test can then prove a write path seals what it
 * writes without standing up Postgres to watch it happen.
 */
export function sealEncryptedFields(
  model: string,
  dataKey: Buffer,
  data: unknown,
) {
  const fields = fieldsFor(model);
  if (fields.length === 0) return data;
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

function openRead(
  model: string,
  fields: readonly string[],
  dataKey: Buffer,
  row: unknown,
): unknown {
  if (!row || typeof row !== "object") return row;
  if (Array.isArray(row))
    return row.map((item) => openRead(model, fields, dataKey, item));
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
 *
 * Built on `getUnguardedPrisma()` and not `getPrisma()`: Prisma runs the
 * first-applied extension first, so the guard `getPrisma()` carries would see
 * this payload on its way in — before the sealing below has touched it — and
 * reject every encrypted write there is. The check still runs, at the point
 * where it is meaningful, a few lines down.
 */
export function encryptedPrisma(dataKey: Buffer) {
  return getUnguardedPrisma().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const fields = fieldsFor(model);

          const input = args as Record<string, unknown>;
          if (fields.length > 0 && input && typeof input === "object") {
            if ("data" in input) {
              const data = input["data"];
              input["data"] = Array.isArray(data)
                ? data.map((item) => sealEncryptedFields(model!, dataKey, item))
                : sealEncryptedFields(model!, dataKey, data);
            }
            // upsert carries both halves.
            for (const half of ["create", "update"] as const) {
              if (half in input)
                input[half] = sealEncryptedFields(model!, dataKey, input[half]);
            }
          }

          // Runs for every model, not just the encrypted ones: what is left
          // unsealed at this point is a shape the sealer above cannot reach —
          // a nested relation write, or Prisma's `{ set: … }` longhand — and
          // those must fail loudly instead of quietly storing cleartext.
          assertEncryptedFieldsSealed(operation, args);

          const result = await query(args);
          if (fields.length === 0) return result;
          // Counts and aggregates come back as numbers; leave them alone.
          if (
            operation.startsWith("count") ||
            operation.startsWith("aggregate")
          )
            return result;

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
export async function backfillEncryptedFields(
  userId: string,
  dataKey: Buffer,
): Promise<number> {
  // Reads only — every write below goes through `sealed`. Which of the two
  // clients this is makes no difference to the guard, since it lets reads
  // past; it is the unguarded one only to keep this module on a single client.
  const plain = getUnguardedPrisma();
  const sealed = encryptedPrisma(dataKey);
  let migrated = 0;

  const pending = (row: Record<string, unknown>, fields: readonly string[]) =>
    fields.filter(
      (field) =>
        typeof row[field] === "string" && !isEncryptedField(row[field]),
    );

  for (const profile of await plain.userProfile.findMany({
    where: { userId },
  })) {
    const row = profile as unknown as Record<string, unknown>;
    const fields = pending(row, ENCRYPTED_FIELDS["UserProfile"]!);
    if (fields.length === 0) continue;
    await sealed.userProfile.update({
      where: { id: profile.id },
      data: Object.fromEntries(fields.map((field) => [field, row[field]])),
    });
    migrated += 1;
  }

  for (const account of await plain.bankAccount.findMany({
    where: { userProfile: { userId } },
  })) {
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
