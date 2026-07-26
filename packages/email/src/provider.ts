/**
 * The seam between "what the app wants to send" and "who actually sends it".
 *
 * Resend is the only implementation today, but it is a hosted API: it needs
 * outbound internet and an account, which not every self-hosted install can
 * or wants to depend on. Callers therefore never import the Resend client
 * directly — they go through `sendEmail`, so adding SMTP later is a new file
 * plus a branch in `resolveProvider`, with no change to callers, templates,
 * or the admin UI.
 */

export type EmailAddress = string;

export interface OutgoingEmail {
  to: EmailAddress;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send results are returned, never thrown, because every caller is either a
 * background auth hook (where a throw becomes an unhandled rejection) or an
 * admin action that wants to render the reason in the UI.
 */
export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail, from: string): Promise<SendResult>;
}

export const SUPPORTED_PROVIDERS = ["resend"] as const;
export type ProviderName = (typeof SUPPORTED_PROVIDERS)[number];

export function isSupportedProvider(value: unknown): value is ProviderName {
  return (
    typeof value === "string" &&
    (SUPPORTED_PROVIDERS as readonly string[]).includes(value)
  );
}
