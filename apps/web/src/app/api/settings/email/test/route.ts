import { NextResponse } from "next/server";

import { getAdminSession } from "@billow/auth";
import { sendEmail } from "@billow/email";
import { TestEmail, testEmailText } from "@billow/email/templates";
import { error } from "@/lib/api/respond";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { getAppMetadata } from "@/lib/app-metadata";
import { recordError } from "@/lib/error-log";

export const dynamic = "force-dynamic";

/**
 * Sends a test message to the requesting administrator's own address.
 *
 * The recipient is taken from the session, never from the request body: an
 * endpoint that mails arbitrary addresses on demand is an open relay wearing
 * a different hat, usable to send attacker-chosen mail from the install's
 * verified domain.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return error("Invalid request origin.", 403);
  }

  const { session, admin } = await getAdminSession();
  if (!session) return error("Authentication required.", 401);
  if (!admin) return error("Administrator access required.", 403);

  const recipient = session.user.email;
  if (!recipient) {
    return error("Your account has no email address to send to.", 400);
  }

  const metadata = await getAppMetadata();
  const appName = metadata?.name ?? "Billow";
  const sentAt = new Date().toISOString();
  const props = {
    appName,
    sentAt,
    sentBy: session.user.name || recipient,
  };

  const result = await sendEmail(recipient, {
    subject: `${appName}: test message`,
    element: TestEmail(props),
    text: testEmailText(props),
  });

  if (!result.ok) {
    // Worth recording: a failed test is the operator actively debugging, and
    // the diagnostics page is where they will look next. `result.error` is
    // provider text, which never contains the API key.
    await recordError("settings.email.test", new Error(result.error), {
      recipient,
    });
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, id: result.id, sentTo: recipient });
}
