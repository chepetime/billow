import { getDataKey, getSession, issueRecoveryKeyFor } from "@billow/auth";
import { NextResponse } from "next/server";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { error } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * Issues a recovery key and returns it in the response body. This is the only
 * moment the key is knowable — it is never stored, only the data key wrapped
 * under it is — so the response is `no-store` and the caller is expected to
 * put it in front of the user immediately.
 *
 * Session-only, deliberately. An API key carries no data-key cookie, so it has
 * nothing to wrap; and minting a recovery key is exactly the operation that
 * should require the person, not a token left in a script.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return error("Invalid request origin.", 403);

  const session = await getSession();
  if (!session) return error("Sign in to generate a recovery key.", 401);

  // scrypt runs below; throttle before spending it.
  const limit = await consumeRateLimit(
    `recovery-key:issue:${session.user.id}`,
    5,
    300,
  );
  if (!limit.allowed) {
    return error(
      `Too many attempts. Try again in ${limit.retryAfter} seconds.`,
      429,
    );
  }

  const dataKey = await getDataKey(session.user.id, session.session.id);
  if (!dataKey) {
    // No data key on this session: signed in before the keyset existed, or the
    // cookie is gone. Signing in again mints or re-opens one.
    return error("Sign in again to generate a recovery key.", 409);
  }

  const recoveryKey = await issueRecoveryKeyFor(session.user.id, dataKey);
  if (!recoveryKey) return error("This account has no keyset yet.", 409);

  return NextResponse.json({ recoveryKey }, { headers: noStore });
}
