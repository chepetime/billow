import { PlaintextEncryptedWriteError } from "@billow/db/field-encryption";
import { recordError } from "@/lib/error-log";

/**
 * What every workspace server action returns.
 *
 * Actions return a result instead of throwing because a thrown error in a
 * server action reaches the client as a redacted digest in production — the
 * user sees "an error occurred" and the reason is only in the container log.
 * The conventions already split field errors (from the resolver) from request
 * errors (the server said no); this is the request-error channel.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok(): ActionResult;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = "P2002";
/** Prisma's foreign-key violation — what `onDelete: Restrict` raises. */
const FOREIGN_KEY_VIOLATION = "P2003";

function prismaErrorCode(error: unknown): string | null {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/**
 * Turn a thrown error into a message worth showing, and log everything else.
 *
 * The two Prisma codes handled here are the ones a user can trigger by
 * ordinary use — reusing an invoice number, deleting a client that still has
 * invoices — and both deserve a sentence rather than "something went wrong".
 */
export async function toActionError(
  context: string,
  error: unknown,
  messages: { unique?: string; inUse?: string } = {},
): Promise<ActionResult<never>> {
  const code = prismaErrorCode(error);

  if (code === UNIQUE_VIOLATION && messages.unique) {
    return fail(messages.unique);
  }

  if (code === FOREIGN_KEY_VIOLATION && messages.inUse) {
    return fail(messages.inUse);
  }

  // The guard in @billow/db fired: this request had no data key, so the write
  // would have stored cleartext in an encrypted column. That is a session
  // problem, not a form problem, and saying so is more useful than a digest.
  if (error instanceof PlaintextEncryptedWriteError) {
    return fail(
      "Your encryption key is not available in this session. Sign out and back in, then try again.",
    );
  }

  await recordError(context, error);
  return fail("Something went wrong saving that. Please try again.");
}
