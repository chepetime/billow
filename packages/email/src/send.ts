import "server-only";

import { render } from "@react-email/render";
import type { ReactElement } from "react";

import { createResendProvider } from "./providers/resend";
import type { SendResult } from "./provider";
import { getSendingCredentials } from "./settings";

export interface RenderedMessage {
  subject: string;
  element: ReactElement;
  text: string;
}

/**
 * Renders and sends, or explains why it could not.
 *
 * Never throws. better-auth invokes its email hooks through
 * `runInBackgroundOrAwait`, so a rejection there surfaces as an unhandled
 * rejection with no route to report it; and the admin test-send button needs
 * the reason as a value it can display. Callers decide whether a failure is
 * worth recording.
 */
export async function sendEmail(
  to: string,
  message: RenderedMessage,
): Promise<SendResult> {
  const credentials = await getSendingCredentials();
  if (!credentials) {
    return {
      ok: false,
      error:
        "Email is not configured. An administrator must add an API key and sender address in Settings → Administration.",
    };
  }

  let html: string;
  try {
    html = await render(message.element);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `Could not render the message. (${detail})` };
  }

  const provider = createResendProvider(credentials.apiKey);
  return provider.send(
    { to, subject: message.subject, html, text: message.text },
    credentials.from,
  );
}
