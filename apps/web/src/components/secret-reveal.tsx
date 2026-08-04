"use client";

import { useEffect, useId, useState } from "react";

import { CopyButton } from "@/components/motion/copy-button";

/**
 * One place to show a secret the user only ever sees once — an API key, a TOTP
 * setup key, a recovery key. Getting that secret out of the browser and into
 * wherever the user actually keeps things is the whole job, so this offers
 * every route that works rather than betting on one:
 *
 * - **Copy to clipboard**, which works everywhere and is the floor.
 * - **A read-only field carrying the right `autocomplete` token**, which is
 *   what lets a password manager recognise the value as the kind of secret it
 *   is instead of an anonymous string.
 * - **An `otpauth:` link** for TOTP, which desktop authenticators register as
 *   a handler for — the QR code only helps someone holding a phone.
 * - **The Save in 1Password button**, which is one click for the people who
 *   have that extension and invisible to everyone else.
 *
 * Deliberately not claimed: none of this can *guarantee* a password manager
 * offers to save. Without a real sign-in submission most managers will not
 * prompt on their own, so the copy button stays the dependable path and the
 * rest is enhancement on top of it.
 */
export type SecretRevealProps = {
  /** Suggested title for the saved item. */
  title: string;
  secret: string;
  /** How the secret is described in the UI and to assistive tech. */
  label: string;
  /**
   * The HTML autofill token that best describes this secret. `one-time-code`
   * marks a TOTP seed; `new-password` is the closest standard token for an API
   * or recovery key, which the spec has no dedicated value for.
   */
  autoComplete: "new-password" | "one-time-code";
  /** Which kind of 1Password item to offer to create. */
  onePasswordType: "api-key" | "login";
  /** Shown alongside the secret so a saved login item is identifiable. */
  username?: string;
  /** TOTP only: the `otpauth://` URI behind the QR code. */
  otpauthUri?: string;
  /** Free text stored with the item, and shown as help under the secret. */
  notes?: string;
};

type SaveRequestField = { autocomplete: string; value: string };

export function SecretReveal({
  title,
  secret,
  label,
  autoComplete,
  onePasswordType,
  username,
  otpauthUri,
  notes,
}: SecretRevealProps) {
  const fieldId = useId();
  const [saveRequest, setSaveRequest] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Loaded in the browser only: the package registers a custom element, and
    // its own button stays disabled until the 1Password extension enables it.
    // Anyone without the extension simply never sees it, so a failure to load
    // is not worth surfacing — the copy button already covers them.
    void import("@1password/save-button")
      .then(({ activateOPButton, encodeOPSaveRequest }) => {
        if (cancelled) return;

        const fields: SaveRequestField[] = [{ autocomplete: autoComplete, value: secret }];
        if (username) fields.unshift({ autocomplete: "username", value: username });

        // Tie the saved item to this installation's own origin. It has to be
        // read at runtime: every install lives somewhere different —
        // umbrel.local on one, a Tailscale name or a tunnel on another — so
        // there is no URL that could be baked in, and an item saved without
        // one is a loose secret the manager cannot offer to fill anywhere.
        //
        // 1Password's own docs say it derives the URL from the page, but the
        // save request accepts `urls` explicitly, and being explicit costs
        // nothing and does not depend on that behaviour holding.
        const encoded = encodeOPSaveRequest({
          title,
          fields,
          urls: [window.location.origin],
          ...(notes ? { notes } : {}),
        } as never);
        if (!encoded) return;

        setSaveRequest(encoded);
        // Next routes on the client, so the extension needs telling that a
        // button appeared without a page load.
        activateOPButton();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [autoComplete, notes, secret, title, username]);

  return (
    <div className="space-y-3">
      <p className="font-mono text-xs break-all" data-testid="revealed-secret">
        {secret}
      </p>

      {/*
        Off-screen rather than `hidden` or `type="hidden"`: password managers
        skip fields they consider unrenderable, and this needs to look like a
        real credential field to be recognised as one. It stays reachable to
        screen readers, which is why it is labelled.
      */}
      <div className="sr-only">
        {username ? (
          <input type="text" readOnly value={username} autoComplete="username" aria-hidden="true" tabIndex={-1} />
        ) : null}
        <label htmlFor={fieldId}>{label}</label>
        <input
          id={fieldId}
          type="text"
          readOnly
          value={secret}
          autoComplete={autoComplete}
          tabIndex={-1}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CopyButton value={secret} label={`Copy ${label.toLowerCase()}`} copiedLabel="Copied" />
        {otpauthUri ? (
          <a
            href={otpauthUri}
            className="text-sm underline underline-offset-4 hover:no-underline"
          >
            Open in authenticator app
          </a>
        ) : null}
      </div>

      {saveRequest ? (
        <onepassword-save-button
          data-onepassword-type={onePasswordType}
          value={saveRequest}
          padding="none"
        />
      ) : null}
    </div>
  );
}
