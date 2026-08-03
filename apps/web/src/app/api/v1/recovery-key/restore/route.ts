import { NextResponse } from "next/server";
import { z } from "zod";

import { auth, dataKeyCookies, getSession, restoreAccessWithRecoveryKey } from "@billow/auth";
import { headers } from "next/headers";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { error } from "@/lib/api/respond";
import { isSameOriginRequest } from "@/lib/api/request-origin";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const payloadSchema = z.object({
  recoveryKey: z.string().min(1).max(128),
  password: z.string().min(1).max(1024),
});

/**
 * Undoes a lockout: unwraps the data key with the recovery key and re-wraps it
 * under the password the account now has, then re-opens this session.
 *
 * One generic failure for a wrong recovery key and a wrong password alike.
 * They are both guesses against the same account, and saying which half was
 * right halves the work of guessing the other.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return error("Invalid request origin.", 403);

  const session = await getSession();
  if (!session) return error("Sign in to restore access.", 401);

  // scrypt runs below; throttle before spending it.
  const limit = await consumeRateLimit(`recovery-key:restore:${session.user.id}`, 5, 300);
  if (!limit.allowed) {
    return error(`Too many attempts. Try again in ${limit.retryAfter} seconds.`, 429);
  }

  const body = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return error("Enter your recovery key and password.", 400);

  // Delegated to better-auth rather than compared here: it owns the hashing
  // scheme, and a check written alongside it would drift the moment that
  // changes.
  const requestHeaders = await headers();
  const verifyPassword = async (password: string) => {
    try {
      await auth.api.verifyPassword({ body: { password }, headers: requestHeaders });
      return true;
    } catch {
      return false;
    }
  };

  const sessionKey = await restoreAccessWithRecoveryKey(
    session.user.id,
    session.session.id,
    body.data.recoveryKey,
    body.data.password,
    verifyPassword,
  );
  if (!sessionKey) {
    return error("That recovery key and password do not unlock this account.", 400);
  }

  const response = NextResponse.json({ restored: true }, { headers: noStore });
  // Shared options rather than a second copy: this cookie's lifetime has to
  // track the session's, and two hand-written copies drift.
  response.cookies.set(dataKeyCookies.name, sessionKey, dataKeyCookies.options);
  return response;
}
