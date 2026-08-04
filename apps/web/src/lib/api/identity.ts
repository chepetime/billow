import "server-only";

import { auth } from "@billow/auth";
import { error } from "@/lib/api/respond";

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
