/**
 * Seam for outbound authentication email.
 *
 * This package deliberately has no mail dependency of its own — the same
 * reasoning as `setAuthErrorReporter` in ./session. Auth was extracted to be
 * auditable in isolation, and importing a provider SDK plus a React email
 * renderer here would drag both into every audit of it.
 *
 * The host app registers a mailer once at startup (see
 * apps/web/src/instrumentation.ts). Until it does, authentication email is a
 * no-op: better-auth's own routes already return the same "if this address
 * exists, check your email" response either way, so an unconfigured install
 * behaves exactly as it did before delivery existed.
 */

import { authRegistry } from "./registry";

export interface PasswordResetMessage {
  user: { id: string; email: string; name?: string };
  /**
   * The reset link as better-auth composed it, built from its configured
   * baseURL. That baseURL is the in-container `http://localhost:3000` here,
   * so a mailer MUST re-point this at an origin the recipient can reach
   * before sending. See packages/email/src/public-url.ts.
   */
  url: string;
  /** The request that triggered the reset, when one exists. */
  request?: Request | undefined;
}

export type AuthMailer = (
  message: PasswordResetMessage,
) => void | Promise<void>;

// Held on globalThis, not in module scope — see ./registry. A module-level
// variable here silently lost the registration, so password-reset emails were
// never sent and nothing anywhere said so.
export function setAuthMailer(mailer: AuthMailer): void {
  authRegistry().mailer = mailer;
}

export async function deliverPasswordReset(
  message: PasswordResetMessage,
): Promise<void> {
  const mailer = authRegistry().mailer;
  if (!mailer) {
    // Reaching here means a reset was requested on an installation with no
    // mailer registered. That is expected only when email is unconfigured —
    // and in that case the request page is not reachable in the first place,
    // so it is worth a line rather than a silent return.
    console.info(
      `[auth] password reset requested for user ${message.user.id} but no mailer is registered; nothing was sent.`,
    );
    return;
  }

  try {
    await mailer(message);
  } catch (error) {
    // better-auth invokes this through `runInBackgroundOrAwait`, so a
    // rejection here would surface as an unhandled rejection with no route to
    // report it. The message is deliberately free of the URL and token:
    // anyone who can read container logs could otherwise take over the
    // account this reset belongs to.
    console.error(
      `[auth] password reset delivery failed for user ${message.user.id}`,
      error instanceof Error ? error.message : error,
    );
  }
}
