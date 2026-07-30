/**
 * Whether features that depend on outbound email may be shown.
 *
 * Kept pure and separate from the database read so the rule itself is
 * directly testable — the question "should this install offer password
 * reset?" is a security-visible decision, not a detail of a Prisma query.
 *
 * The bar is deliberately higher than "an API key is stored". A key proves
 * nothing about delivery: the sending domain may not be verified, the key may
 * have been revoked, and a self-hosted box may have no outbound route at all.
 * Showing a "Forgot your password?" link on an install where mail silently
 * fails is worse than not showing it — the user believes recovery is under
 * way, waits for a message that will never arrive, and never asks the
 * administrator for the manual reset that would actually work.
 */

export interface EmailCapabilityInput {
  /** A credential is stored and could be decrypted. */
  configured: boolean;
  /** A sender address is set. */
  fromEmail: string | null;
  /** When a send last actually succeeded, if ever. */
  verifiedAt: Date | string | null;
  /**
   * A credential is stored but will not decrypt, usually because
   * BETTER_AUTH_SECRET was rotated. Distinguished from "no key" so the
   * diagnostics page does not report "no API key is stored" directly above the
   * stored key's decryption error.
   */
  credentialUnreadable?: boolean | undefined;
}

export interface EmailCapability {
  configured: boolean;
  verified: boolean;
  /** The single flag features should branch on. */
  canSendUserEmail: boolean;
  /** Why it is off, for the administration page. Null when it is on. */
  blockedReason: string | null;
}

export function resolveEmailCapability(
  input: EmailCapabilityInput,
): EmailCapability {
  const configured = input.configured && Boolean(input.fromEmail);
  const verified = configured && input.verifiedAt !== null;

  let blockedReason: string | null = null;
  if (input.credentialUnreadable) {
    blockedReason =
      "The stored API key cannot be decrypted. If BETTER_AUTH_SECRET was rotated, re-enter the key.";
  } else if (!input.configured) {
    blockedReason = "No API key is stored.";
  } else if (!input.fromEmail) {
    blockedReason = "No sender address is set.";
  } else if (!verified) {
    blockedReason =
      "No test message has been delivered yet. Send one to confirm the key, the sender domain, and this server's outbound connection.";
  }

  return {
    configured,
    verified,
    canSendUserEmail: verified,
    blockedReason,
  };
}

/**
 * The value used when the capability cannot be determined — a database
 * failure, a malformed row. Fails closed: an install that cannot answer the
 * question does not advertise the feature.
 */
export const EMAIL_CAPABILITY_UNKNOWN: EmailCapability = {
  configured: false,
  verified: false,
  canSendUserEmail: false,
  blockedReason: "Email configuration could not be read.",
};
