import { NextResponse } from "next/server";
import { z } from "zod";

import { confirmRecoveryKeySaved, getSession } from "@billow/auth";
import { error } from "@/lib/api/respond";
import { isSameOriginRequest } from "@/lib/api/request-origin";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const payloadSchema = z.object({ recoveryKey: z.string().min(1).max(128) });

/**
 * Records that the user actually has the key, by making them use it. A wrong
 * key is a 400 rather than a 401: they are signed in, they simply typed it
 * wrong, and the flow lets them try again or generate a fresh one.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return error("Invalid request origin.", 403);

  const session = await getSession();
  if (!session) return error("Sign in to confirm your recovery key.", 401);

  const body = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return error("Enter your recovery key.", 400);

  const confirmed = await confirmRecoveryKeySaved(session.user.id, body.data.recoveryKey);
  if (!confirmed) {
    return error("That is not the recovery key for this account.", 400);
  }

  return NextResponse.json({ confirmed: true }, { headers: noStore });
}
