import "server-only";

import { auth } from "@billow/auth";
import { error } from "@/lib/api/respond";

export type ApiIdentity = { userId: string };

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

    return { userId: result.key.referenceId };
  }

  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    return error(
      "Authentication required. Send an API key via x-api-key or sign in.",
      401,
    );
  }

  return { userId: session.user.id };
}
