import "server-only";

import type { PasswordResetMessage } from "@billow/auth";
import {
  getConfiguredPublicUrl,
  resolveEmailOrigin,
  rewriteResetLink,
  sendEmail,
} from "@billow/email";
import { PasswordResetEmail, passwordResetText } from "@billow/email/templates";

import { getAppMetadata } from "@/lib/app-metadata";
import { recordError } from "@/lib/error-log";

// better-auth's default reset-token lifetime; shown to the recipient so the
// message says something true about how long they have.
const RESET_EXPIRY_MINUTES = 60;

/**
 * Delivers a password-reset email.
 *
 * The interesting work is the URL. better-auth composes its link from its own
 * `baseURL`, which this app deliberately leaves as the in-container
 * `http://localhost:3000` so that authentication works behind umbrel.local, a
 * Tailscale name, a Cloudflare tunnel or a raw IP without pinning a domain.
 * Sending that link as-is would put a loopback address in the recipient's
 * inbox — a dead link every time. So the origin is replaced with one the
 * recipient can actually reach before anything is sent.
 */
export async function deliverPasswordResetEmail(
  message: PasswordResetMessage,
): Promise<void> {
  const configured = await getConfiguredPublicUrl();
  const origin = resolveEmailOrigin(
    configured,
    message.request?.headers ?? null,
  );

  if (!origin) {
    // Refusing to send is the correct outcome: better-auth has already
    // consumed the token, and a message whose only link is unreachable tells
    // the user recovery is under way when it is not.
    await recordError(
      "auth.passwordReset.origin",
      new Error(
        "No reachable origin for the reset link. Set a public URL in Settings → Administration → Email.",
      ),
      { userId: message.user.id },
    );
    return;
  }

  const resetUrl = rewriteResetLink(message.url, origin);
  if (!resetUrl) {
    await recordError(
      "auth.passwordReset.url",
      new Error("Could not build a reset link for the configured origin."),
      { userId: message.user.id },
    );
    return;
  }

  const metadata = await getAppMetadata();
  const props = {
    appName: metadata?.name ?? "Billow",
    resetUrl,
    expiresInMinutes: RESET_EXPIRY_MINUTES,
  };

  const result = await sendEmail(message.user.email, {
    subject: `Reset your ${props.appName} password`,
    element: PasswordResetEmail(props),
    text: passwordResetText(props),
  });

  if (!result.ok) {
    // Recorded without the URL or token: this table is readable from the
    // admin diagnostics page, and a working reset link there would be an
    // account takeover for anyone who can see it.
    await recordError(
      "auth.passwordReset.send",
      new Error(result.error),
      { userId: message.user.id },
    );
  }
}
