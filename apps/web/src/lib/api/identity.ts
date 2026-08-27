import "server-only";

import { auth } from "@billow/auth";
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

/** Resolves an API key or browser session to the calling account. */
export async function requireApiIdentity(
  requestHeaders: Headers,
): Promise<ApiIdentity | ReturnType<typeof error>> {
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

    return { userId: result.key.referenceId, via: "apiKey" };
  }

  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    return error(
      "Authentication required. Send an API key via x-api-key or sign in.",
      401,
    );
  }

  return { userId: session.user.id, via: "session" };
}
