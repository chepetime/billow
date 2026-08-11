import { isEncryptedField } from "@billow/crypto";

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
 *
 * It lives in this module rather than next to the sealer so `src/index.ts` can
 * import the guard without importing the sealer, which imports `src/index.ts`
 * back for its client.
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
 * This exists because sealing is opt-in per client, and an opt-in security
 * control is one forgotten client away from being off — which is exactly how
 * `createBankAccount` and `importWorkspace` came to write cleartext account
 * numbers while onboarding wrote sealed ones into the same table. The check is
 * cheap (a walk of the write payload, which is one row's worth of object) and
 * runs in production, because the window it closes is a database dump taken
 * before the next sign-in re-seals the row.
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
 * The guard as a Prisma client extension, so `getPrisma()` — the client the
 * whole repository imports — refuses a plaintext write to an encrypted column
 * instead of performing it.
 *
 * Extracted from `getPrisma()` for the same reason as `createRetryExtension`:
 * the decision it makes can then be exercised against a fake `query` without
 * constructing a real client or reaching a database.
 *
 * **Where this may be applied matters.** Prisma runs the *first*-applied
 * extension first, so an extension added inside `createPrismaClient()` would
 * run before `encryptedPrisma()`'s sealer and reject every legitimate
 * encrypted write on its way in. That is why the sealing client is built on
 * the unguarded base client and calls `assertEncryptedFieldsSealed` itself,
 * after sealing, rather than stacking this extension underneath.
 */
export function createEncryptedWriteGuardExtension() {
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
