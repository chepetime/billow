/**
 * What an API key is allowed to do.
 *
 * Pure and free of `server-only`: the settings UI names a grant when creating
 * a key, and the request path checks one on every call. Both sides read the
 * same vocabulary from here.
 *
 * Two levels, not per-resource permissions. The risk this closes is a key
 * sitting in a script on the same box being able to destroy records — a
 * read-only key removes that entirely, and the account owner is the only
 * principal either way. Per-resource scopes would be a finer cut of the same
 * axis and can be added later; the storage format below already allows it.
 */
export const API_KEY_GRANTS = ["read", "read_write"] as const;

export type ApiKeyGrant = (typeof API_KEY_GRANTS)[number];

/** What a request needs. A mutation needs "write"; everything else "read". */
export type ApiKeyScope = "read" | "write";

/**
 * BetterAuth stores permissions as `Record<string, string[]>`. One resource
 * today, named for the app rather than for a model, so widening later means
 * adding keys rather than reinterpreting this one.
 */
const RESOURCE = "billow";

export function permissionsFor(grant: ApiKeyGrant): Record<string, string[]> {
  return {
    [RESOURCE]: grant === "read_write" ? ["read", "write"] : ["read"],
  };
}

/**
 * Reads a stored permissions blob back into a grant.
 *
 * A key with no permissions at all is reported as "read". Keys created before
 * scopes existed were backfilled, but `authClient.apiKey.create` is still
 * reachable from a browser console and sets none, and BetterAuth itself
 * refuses *every* permission check for a key whose permissions are null. Least
 * privilege rather than lockout: an unscoped key keeps working for reads, and
 * a write tells the caller to issue a scoped key instead.
 */
export function grantOf(permissions: unknown): ApiKeyGrant {
  const actions = readActions(permissions);
  return actions.includes("write") ? "read_write" : "read";
}

export function allows(permissions: unknown, scope: ApiKeyScope): boolean {
  // "read" is implied by any grant; only "write" narrows anything.
  return scope === "read" || readActions(permissions).includes("write");
}

function readActions(permissions: unknown): string[] {
  if (!permissions || typeof permissions !== "object") return [];

  const actions = (permissions as Record<string, unknown>)[RESOURCE];
  return Array.isArray(actions)
    ? actions.filter((action): action is string => typeof action === "string")
    : [];
}

/** Human label for the settings list. */
export function describeGrant(grant: ApiKeyGrant): string {
  return grant === "read_write" ? "Read and write" : "Read only";
}
