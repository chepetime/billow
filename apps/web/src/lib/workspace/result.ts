import "server-only";

import { PlaintextEncryptedWriteError } from "@billow/db/field-encryption";
import { recordError } from "@/lib/error-log";

/**
 * What a workspace rule returns.
 *
 * The rules layer under `lib/workspace/` is the one place a domain invariant
 * is enforced, and it has two callers with nothing in common: a server action
 * rendering copy into a form, and an API route picking an HTTP status. So a
 * refusal carries a *reason*, never a sentence. The moment a rule returns
 * "That client is no longer in your workspace." it has picked a caller, and
 * the other one is left pattern-matching on English to decide between 404 and
 * 409.
 *
 * This is the difference between this type and `lib/actions/result.ts`, which
 * stays where it is: that one is the UI's channel and its `error` is finished
 * copy. An action maps a reason into it (see `lib/actions/clients.ts`).
 */
export type WorkspaceErrorReason =
  /** Input failed its schema. `fields` carries the per-field messages. */
  | "invalid"
  /** No such row *for this owner* — which is also what another owner's id looks like. */
  | "not_found"
  /** A uniqueness rule says no: a reused invoice number, and so on. */
  | "conflict"
  /** A referenced row still exists, so the delete is refused. */
  | "in_use"
  /**
   * The write touched an encrypted column and the caller holds no data key.
   * This is the normal outcome for an API-key caller, not a bug: the key
   * belongs to the signed-in person. See `lib/workspace-prisma.ts`.
   */
  | "no_key"
  /** Anything unexpected. Already logged by the time a caller sees it. */
  | "failed";

export type WorkspaceResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: WorkspaceErrorReason;
      fields?: Record<string, string[] | undefined>;
    };

export function succeed(): WorkspaceResult;
export function succeed<T>(data: T): WorkspaceResult<T>;
export function succeed<T>(data?: T): WorkspaceResult<T | undefined> {
  return { ok: true, data };
}

export function refuse(
  reason: WorkspaceErrorReason,
  fields?: Record<string, string[] | undefined>,
): WorkspaceResult<never> {
  return { ok: false, reason, fields };
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
 * Classifies a thrown error into a reason, logging the ones nobody expected.
 *
 * The two Prisma codes are the ones ordinary use can trigger — reusing an
 * invoice number, deleting a client that still has invoices — so they are
 * outcomes, not incidents, and must not fill the error log. Everything else is
 * recorded here rather than at each call site, so a rule can `catch` without
 * having to remember to log.
 */
export async function refuseFromError(
  context: string,
  error: unknown,
): Promise<WorkspaceResult<never>> {
  const code = prismaErrorCode(error);
  if (code === UNIQUE_VIOLATION) return refuse("conflict");
  if (code === FOREIGN_KEY_VIOLATION) return refuse("in_use");
  if (error instanceof PlaintextEncryptedWriteError) return refuse("no_key");

  await recordError(context, error);
  return refuse("failed");
}
