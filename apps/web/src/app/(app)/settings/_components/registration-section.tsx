"use client";

import { useState } from "react";

import { Switch } from "@billow/shadcn/components/switch";

export function RegistrationSection({ enabled }: { enabled: boolean }) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function updateRegistration(nextEnabled: boolean) {
    setError(null);
    setIsPending(true);
    const response = await fetch("/api/settings/registration", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: nextEnabled }),
    });
    const result = (await response.json().catch(() => null)) as {
      enabled?: boolean;
      error?: string;
    } | null;
    setIsPending(false);

    if (!response.ok || typeof result?.enabled !== "boolean") {
      setError(result?.error ?? "Unable to update registration.");
      return;
    }

    setIsEnabled(result.enabled);
  }

  return (
    <section className="flex items-start justify-between gap-6 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Open registration</h2>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
          Allow new people to create their own private Billow workspace. Each
          account, API key, and invoice workspace stays isolated.
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <Switch
        checked={isEnabled}
        disabled={isPending}
        onCheckedChange={updateRegistration}
        aria-label="Open registration"
      />
    </section>
  );
}
