import "server-only";

import { auth } from "@billow/auth";
import { allows } from "@/lib/api/api-key-scope";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { error, rateLimited } from "@/lib/api/respond";

/**
 * `via` records which credential actually authenticated the request.
 *
 * Routes that skip their same-origin (CSRF) check for API-key callers must
 * decide that from this field and nothing else. Reading the headers a second
 * time to guess at the credential type is how the two answers drift: a header
 * this function ignores — `Authorization: Basic …` — still looks like an API
 * key to a bare presence check, so a cookie-authenticated request would be
 * waved past the guard that exists precisely to stop it.
 */
export type ApiIdentity = { userId: string; via: "apiKey" | "session" };

/**
 * BetterAuth's api-key plugin folds every verification failure into one
 * `{ valid: false, error }` shape, so a throttled key and a forged one arrive
 * here looking identical. They are not: the first is a working credential
 * being asked to wait, and answering it with 401 tells a client its key is
 * bad — which is how a caller ends up deleting a good key, or retrying flat
 * out because nothing told it how long to wait.
 *
 * The plugin tags that case `RATE_LIMITED` and carries the remaining window in
 * `details.tryAgainIn`, in milliseconds. Neither field is in the plugin's
 * public return type, hence the narrowing here rather than a cast.
 */
type VerifyError = { message?: string | null; code?: string | null };

function rateLimitRetrySeconds(verifyError: unknown): number | null {
  const { code, details } = (verifyError ?? {}) as VerifyError & {
    details?: { tryAgainIn?: unknown };
  };
  if (code !== "RATE_LIMITED") return null;

  const tryAgainIn = details?.tryAgainIn;
  // A missing or nonsensical window still gets a retry hint: the status code
  // is the part callers must not lose, and one second is the floor anyway.
  return typeof tryAgainIn === "number" && Number.isFinite(tryAgainIn)
    ? tryAgainIn / 1000
    : 1;
}

/**
 * Resolves an API key or browser session to the calling account, and — for a
 * mutation — checks that a cookie-authenticated caller is this app.
 *
 * The two belong together. The CSRF guard's correctness depends entirely on
 * `via`, and when each route wrote its own copy there were seven of them, all
 * one edit away from disagreeing about a rule whose whole job is to be
 * uniform. A route that forgets the option now differs from its neighbours in
 * one visible argument rather than in a missing block.
 *
 * Ordering is deliberate and is the reason the guard cannot be a separate
 * wrapper applied first: credentials resolve *before* the origin is judged,
 * because answering 403 to a caller who simply sent nothing tells them they
 * are forbidden when what they need is to authenticate.
 *
 * `mutating` should be true for anything that changes state. It is not derived
 * from `request.method` here: the vault reads its own method set, and a route
 * that wants a guard on a GET (or none on a POST) should have to say so.
 *
 * The same flag decides which scope an API key needs — a mutation needs
 * "write", everything else "read". One concept rather than two: a route
 * cannot be CSRF-guarded but scope-free, or the reverse.
 */
export async function requireApiIdentity(
  request: Request,
  options: { mutating?: boolean } = {},
): Promise<ApiIdentity | ReturnType<typeof error>> {
  const requestHeaders = request.headers;
  const authorization = requestHeaders.get("authorization");
  const apiKey =
    requestHeaders.get("x-api-key") ??
    (authorization?.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : null);

  if (apiKey) {
    const result = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!result.valid || !result.key) {
      const retryAfter = rateLimitRetrySeconds(result.error);
      if (retryAfter !== null) {
        return rateLimited(
          "Too many API requests for this key. Try again shortly.",
          retryAfter,
        );
      }

      return error(String(result.error?.message ?? "Invalid API key."), 401);
    }

    // Scopes are checked here rather than by passing `permissions` to
    // verifyApiKey. That path reports an insufficient scope as KEY_NOT_FOUND,
    // which surfaces as a 401 reading "invalid key" — indistinguishable from a
    // forged key, and the same misdiagnosis the rate limiter used to hand out.
    // Checking the returned permissions keeps the two answers apart.
    if (!allows(result.key.permissions, options.mutating ? "write" : "read")) {
      return error(
        "This API key is read-only. Create a read and write key in Settings to make changes.",
        403,
      );
    }

    // A request that carried its own API key is not a form submission a
    // hostile page could forge with the victim's cookies, so it never needs
    // the origin check.
    return { userId: result.key.referenceId, via: "apiKey" };
  }

  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    return error(
      "Authentication required. Send an API key via x-api-key or sign in.",
      401,
    );
  }

  if (options.mutating && !isSameOriginRequest(request)) {
    return error("Invalid request origin.", 403);
  }

  return { userId: session.user.id, via: "session" };
}
