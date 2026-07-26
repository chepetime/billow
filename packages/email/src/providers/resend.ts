import { Resend } from "resend";

import type { EmailProvider, OutgoingEmail, SendResult } from "../provider";

/**
 * Resend delivery.
 *
 * Every failure is converted into `{ ok: false, error }` with a message safe
 * to show an administrator. Provider errors are echoed because they are the
 * whole point of the "send test email" button — "domain is not verified" is
 * exactly what the operator needs to read. The API key is never included in
 * a message, and callers must not log the key alongside these results.
 */
export function createResendProvider(apiKey: string): EmailProvider {
  return {
    name: "resend",

    async send(email: OutgoingEmail, from: string): Promise<SendResult> {
      let client: Resend;
      try {
        client = new Resend(apiKey);
      } catch {
        // Constructor validates the key's shape; a malformed key lands here.
        return {
          ok: false,
          error: "The Resend API key is not valid. Re-enter it and try again.",
        };
      }

      try {
        const { data, error } = await client.emails.send({
          from,
          to: email.to,
          subject: email.subject,
          html: email.html,
          text: email.text,
        });

        if (error) {
          return {
            ok: false,
            error: error.message || "Resend rejected the message.",
          };
        }

        return { ok: true, id: data?.id ?? null };
      } catch (cause) {
        // Network-level failure: no internet, DNS, TLS, or Resend unreachable.
        // Common on a self-hosted box and worth naming explicitly, since the
        // operator's first guess will be that the key is wrong.
        const detail = cause instanceof Error ? cause.message : String(cause);
        return {
          ok: false,
          error: `Could not reach Resend. Check this server's outbound internet access. (${detail})`,
        };
      }
    },
  };
}
