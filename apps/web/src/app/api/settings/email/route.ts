import { NextResponse } from "next/server";

import { getAdminSession } from "@billow/auth";
import {
  getPublicEmailSettings,
  isValidEmail,
  normalizePublicUrl,
  updateEmailSettings,
} from "@billow/email";
import { error } from "@/lib/api/respond";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { recordError } from "@/lib/error-log";

export const dynamic = "force-dynamic";

/**
 * Email configuration is installation-wide and holds a sending credential,
 * so both verbs are administrator-only.
 *
 * No response on this route ever contains the API key: GET and PATCH both
 * return `getPublicEmailSettings()`, whose type has no field able to carry it.
 */
export async function GET() {
  const { session, admin } = await getAdminSession();
  if (!session) return error("Authentication required.", 401);
  if (!admin) return error("Administrator access required.", 403);

  return NextResponse.json(await getPublicEmailSettings());
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    return error("Invalid request origin.", 403);
  }

  const { session, admin } = await getAdminSession();
  if (!session) return error("Authentication required.", 401);
  if (!admin) return error("Administrator access required.", 403);

  const body = (await request.json().catch(() => null)) as {
    apiKey?: unknown;
    fromEmail?: unknown;
    fromName?: unknown;
    publicUrl?: unknown;
  } | null;

  if (!body || typeof body !== "object") {
    return error("A JSON body is required.", 400);
  }

  const update: Parameters<typeof updateEmailSettings>[0] = {
    updatedById: session.user.id,
  };

  // Omitted means "leave as is" so the sender address can be edited without
  // re-entering the credential; an explicit empty string clears it.
  if (body.apiKey !== undefined) {
    if (typeof body.apiKey !== "string") {
      return error("apiKey must be a string.", 400);
    }
    const trimmed = body.apiKey.trim();
    if (trimmed && trimmed.length < 8) {
      return error("That API key looks too short to be valid.", 400);
    }
    update.apiKey = trimmed;
  }

  if (body.fromEmail !== undefined) {
    if (typeof body.fromEmail !== "string" || !isValidEmail(body.fromEmail.trim())) {
      return error("A valid sender address is required.", 400);
    }
    update.fromEmail = body.fromEmail.trim();
  }

  if (body.fromName !== undefined) {
    if (typeof body.fromName !== "string" || body.fromName.length > 100) {
      return error("The sender name must be 100 characters or fewer.", 400);
    }
    update.fromName = body.fromName.trim();
  }

  if (body.publicUrl !== undefined) {
    if (typeof body.publicUrl !== "string") {
      return error("publicUrl must be a string.", 400);
    }
    const trimmed = body.publicUrl.trim();
    if (trimmed && !normalizePublicUrl(trimmed)) {
      return error(
        "That public URL is not usable in an email. Use a full http(s) address that recipients can reach — not localhost.",
        400,
      );
    }
    update.publicUrl = trimmed;
  }

  try {
    return NextResponse.json(await updateEmailSettings(update));
  } catch (cause) {
    // Most likely BETTER_AUTH_SECRET missing, which makes the credential
    // unencryptable. Recorded without the key ever being logged.
    await recordError("settings.email.update", cause);
    return error("Could not save the email settings.", 500);
  }
}
