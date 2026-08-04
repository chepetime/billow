import "server-only";

import type { PasswordResetMessage } from "@billow/auth";
import {
  clearEmailVerification,
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
 *
 * Absent a configured public URL, that replacement origin comes from the
 * triggering request's `Host`/`X-Forwarded-Host` headers — values the
 * request's own sender controls, not just a proxy. BILLOW_TRUSTED_ORIGINS
 * (the same env var `trustedOrigins` in packages/auth/src/auth.ts uses for
 * its CSRF check) is passed through so a forged header can be rejected
 * instead of trusted; see the RESIDUAL RISK note in
 * packages/email/src/public-url.ts for the gap that remains when neither is set.
 */
export async function deliverPasswordResetEmail(
  message: PasswordResetMessage,
): Promise<void> {
  const configured = await getConfiguredPublicUrl();
  const origin = resolveEmailOrigin(
    configured,
    message.request?.headers ?? null,
    process.env.BILLOW_TRUSTED_ORIGINS,
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
    await recordError("auth.passwordReset.send", new Error(result.error), {
      userId: message.user.id,
    });

    // Email was verified at some point but has now failed for a real user.
    // Withdrawing verification hides the reset link again, so the next person
    // is told to contact an administrator instead of waiting for a message
    // that will not arrive.
    await clearEmailVerification();
  }
}
