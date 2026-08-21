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

/** Operations that can put a value in a column. Everything else only reads. */
const WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);

/**
 * Every encrypted field, flattened to `field -> Model.field`, so a payload can
 * be checked by field name alone. Names are unique across the models above; if
 * two ever collide the wrong model is named in the error message and nothing
 * else changes, which is a price worth paying for catching nested writes.
 */
const ENCRYPTED_FIELD_PATHS = new Map<string, string>(
  Object.entries(ENCRYPTED_FIELDS).flatMap(([model, fields]) =>
    fields.map((field) => [field, `${model}.${field}`] as const),
  ),
);

/**
 * A refused write, not a failed one — nothing was sent to Postgres. Named so a
 * caller catching it can tell it apart from a database error, and so the fix
 * (use the encrypted client) is in the type rather than only in the string.
 */
export class PlaintextEncryptedWriteError extends Error {
  constructor(paths: readonly string[]) {
    super(
      `Refusing to write plaintext into encrypted columns: ${paths.join(", ")}. ` +
        "Writes to these models must go through getWorkspacePrisma() / encryptedPrisma().",
    );
    this.name = "PlaintextEncryptedWriteError";
  }
}

function collectPlaintext(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPlaintext(item, found);
    return;
  }
  if (!node || typeof node !== "object") return;

  for (const [key, value] of Object.entries(node)) {
    // `where` selects rows, it never stores one. A plaintext filter on an
    // encrypted column is broken for a different reason (ciphertext differs on
    // every write, so it simply never matches) and is not this guard's business.
    if (key === "where") continue;

    const path = ENCRYPTED_FIELD_PATHS.get(key);
    if (path) {
      // `{ field: "x" }` and Prisma's longhand `{ field: { set: "x" } }` are
      // the same write. The sealer only understands the first, so the second
      // has to fail here rather than reach the column unsealed.
      const written =
        typeof value === "string"
          ? value
          : ((value as { set?: unknown } | null)?.set ?? null);
      if (typeof written === "string" && written.length > 0) {
        if (!isEncryptedField(written)) found.add(path);
        continue;
      }
    }

    collectPlaintext(value, found);
  }
}

/**
 * Throws when a write would land a plaintext value in a column that is
 * supposed to hold ciphertext.
 *
 * This exists because the extension is opt-in per client, and an opt-in
 * security control is one forgotten `getPrisma()` away from being off — which
 * is exactly how `createBankAccount` and `importWorkspace` came to write
 * cleartext account numbers while onboarding wrote sealed ones into the same
 * table. The check is cheap (a walk of the write payload, which is one row's
 * worth of object) and runs in production, because the window it closes is a
 * database dump taken before the next sign-in re-seals the row.
 *
 * It walks the whole payload rather than the operated-on model's own fields,
 * so it also catches what the sealer structurally cannot: a nested relation
 * write reports the *parent* model to `$allOperations`, so
 * `userProfile.create({ data: { bankAccounts: { create: … } } })` never gets
 * near `sealEncryptedFields`.
 */
export function assertEncryptedFieldsSealed(
  operation: string,
  args: unknown,
): void {
  if (!WRITE_OPERATIONS.has(operation)) return;

  const found = new Set<string>();
  collectPlaintext(args, found);
  if (found.size > 0) {
    throw new PlaintextEncryptedWriteError([...found].sort());
  }
}

/**
 * The plain client, with plaintext writes to encrypted columns turned from a
 * silent leak into a thrown error.
 *
 * For callers that legitimately have no data key. They can still read (as
 * ciphertext) and delete; what they can no longer do is write a value that
 * everything else in the system believes is encrypted.
 */
export function createGuardedExtension() {
  return {
    name: "reject-plaintext-encrypted-writes",
    query: {
      $allModels: {
        async $allOperations({
          operation,
          args,
          query,
        }: {
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          assertEncryptedFieldsSealed(operation, args);
          return query(args);
        },
      },
    },
  };
}

export function guardedPrisma() {
  return getPrisma().$extends(createGuardedExtension());
}

/**
 * Decrypts every encrypted field anywhere in a query result, not just on the
 * model that was directly queried.
 *
 * This has to walk the whole tree rather than key off the queried model's own
 * field list: `$allOperations` only reports the *root* model (`invoice.
 * findFirst({ include: { userProfile: true, bankAccount: true } })` reports
 * "Invoice", which has no encrypted fields of its own), so a decrypt keyed on
 * that model would silently skip every included relation. Keying on the field
 * *name* instead — the same `ENCRYPTED_FIELD_PATHS` map the write-side guard
 * already walks a payload with — finds a `userProfile.taxId` or
 * `bankAccount.accountNumber` no matter how deep the include nested it in.
 * The tradeoff is the same one that map already accepts: two models sharing a
 * field name would decrypt under the wrong one's associated data and fail.
 */
function openRead(dataKey: Buffer, node: unknown): unknown {
  if (Array.isArray(node)) {
    for (const item of node) openRead(dataKey, item);
    return node;
  }
  if (!node || typeof node !== "object") return node;
  const record = node as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    const path = ENCRYPTED_FIELD_PATHS.get(key);
    // Plaintext written before this shipped stays readable as itself.
    // Enabling encryption must not make existing rows unreadable.
    if (path && typeof value === "string" && isEncryptedField(value)) {
      try {
        record[key] = decryptField(dataKey, path, value);
      } catch {
        // Wrong key, or a value tampered with. Report it as absent rather
        // than throwing: one unreadable column should not take down the
        // page, and a blank field is an honest description of what the
        // caller can see.
        record[key] = null;
      }
      continue;
    }
    if (value && typeof value === "object") openRead(dataKey, value);
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
 * Extracted from `encryptedPrisma` so the seal/guard/decrypt sequence can be
 * exercised directly in tests against a fake `query`, without constructing a
 * real PrismaClient or reaching a database — the same reason
 * `createRetryExtension` (./index.ts) is its own function.
 */
export function createEncryptedExtension(dataKey: Buffer) {
  return {
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model?: string;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
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
          // Counts and aggregates come back as numbers; leave them alone.
          if (
            operation.startsWith("count") ||
            operation.startsWith("aggregate")
          )
            return result;

          return openRead(dataKey, result);
        },
      },
    },
  };
}

export function encryptedPrisma(dataKey: Buffer) {
  return getPrisma().$extends(createEncryptedExtension(dataKey));
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
  const plain = getPrisma();
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
