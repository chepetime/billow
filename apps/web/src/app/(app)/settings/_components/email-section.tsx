"use client";

import type { PublicEmailSettings } from "@billow/email";

import { Button } from "@billow/shadcn/components/button";
import { Input } from "@billow/shadcn/components/input";
import { Label } from "@billow/shadcn/components/label";
import { useState } from "react";
import { notifyError, notifySuccess } from "@/lib/notify";

interface EmailSectionProps {
  settings: PublicEmailSettings;
}

export function EmailSection({ settings }: EmailSectionProps) {
  const [current, setCurrent] = useState(settings);
  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState(settings.fromEmail ?? "");
  const [fromName, setFromName] = useState(settings.fromName ?? "");
  const [publicUrl, setPublicUrl] = useState(settings.publicUrl ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);

    try {
      const payload: Record<string, string> = {
        fromEmail: fromEmail.trim(),
        fromName: fromName.trim(),
        publicUrl: publicUrl.trim(),
      };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();

      const response = await fetch("/api/settings/email", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notifyError("Could not save", body?.error ?? undefined);
        return;
      }

      setCurrent(body as PublicEmailSettings);
      setApiKey("");
      notifySuccess("Email settings saved");
    } catch {
      notifyError("Could not save", "Could not reach the server.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTest() {
    setIsTesting(true);

    try {
      const response = await fetch("/api/settings/email/test", {
        method: "POST",
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.ok) {
        notifyError("Test message failed", body?.error ?? undefined);
        return;
      }

      notifySuccess("Test message sent", `Check ${body.sentTo}.`);
    } catch {
      notifyError("Test message failed", "Could not reach the server.");
    } finally {
      setIsTesting(false);
    }
  }

  async function handleClearKey() {
    setIsSaving(true);

    try {
      const response = await fetch("/api/settings/email", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "" }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notifyError("Could not remove the key", body?.error ?? undefined);
        return;
      }

      setCurrent(body as PublicEmailSettings);
      notifySuccess("API key removed");
    } catch {
      notifyError("Could not remove the key", "Could not reach the server.");
    } finally {
      setIsSaving(false);
    }
  }

  const canTest = current.configured && Boolean(current.fromEmail);

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Email</h2>
        <p className="text-sm text-muted-foreground">
          Outbound email through Resend. Without it, password resets cannot
          reach anyone and an administrator has to set passwords by hand.
        </p>
      </div>

      {current.credentialError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {current.credentialError}
        </p>
      ) : null}

      <div
        className={
          current.capability.canSendUserEmail
            ? "rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3"
            : "rounded-md border bg-muted/40 p-3"
        }
      >
        <p className="text-sm font-medium">
          {current.capability.canSendUserEmail
            ? "Email is verified"
            : "Email is not verified yet"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {current.capability.canSendUserEmail ? (
            <>
              Password reset is available to everyone on the sign-in page.
              {current.verifiedAt
                ? ` Last confirmed ${new Date(current.verifiedAt).toLocaleString()}.`
                : null}
            </>
          ) : (
            <>
              {current.capability.blockedReason} Until a test message goes
              through, the &ldquo;Forgot your password?&rdquo; link stays hidden
              and people locked out need an administrator to set their password.
            </>
          )}
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email-api-key">Resend API key</Label>
          <Input
            id="email-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              current.apiKeyHint
                ? `Stored: ${current.apiKeyHint} — type to replace`
                : "re_..."
            }
          />
          <p className="text-xs text-muted-foreground">
            Stored encrypted. It is never shown again after saving, and never
            sent back to this page.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="email-from">Sender address</Label>
            <Input
              id="email-from"
              type="email"
              value={fromEmail}
              onChange={(event) => setFromEmail(event.target.value)}
              placeholder="billow@your-domain.com"
              required
            />
            <p className="text-xs text-muted-foreground">
              Must be on a domain verified with Resend.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-from-name">Sender name</Label>
            <Input
              id="email-from-name"
              value={fromName}
              onChange={(event) => setFromName(event.target.value)}
              placeholder="Billow"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email-public-url">Public URL for links</Label>
          <Input
            id="email-public-url"
            type="url"
            value={publicUrl}
            onChange={(event) => setPublicUrl(event.target.value)}
            placeholder="https://billow.your-domain.com"
          />
          <p className="text-xs text-muted-foreground">
            Optional. Links in emails normally use whichever address you are
            reached on. Set this to pin them to one hostname — useful when you
            administer over umbrel.local but read email elsewhere.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={!canTest || isTesting || isSaving}
          >
            {isTesting ? "Sending..." : "Send test message"}
          </Button>

          {current.apiKeyHint ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleClearKey}
              disabled={isSaving}
            >
              Remove key
            </Button>
          ) : null}
        </div>

        {!canTest ? (
          <p className="text-xs text-muted-foreground">
            Save an API key and sender address to enable the test message.
          </p>
        ) : null}
      </form>
    </section>
  );
}
