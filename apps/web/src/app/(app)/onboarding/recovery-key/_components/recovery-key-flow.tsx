"use client";

import { Button } from "@billow/shadcn/components/button";
import { Input } from "@billow/shadcn/components/input";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SecretReveal } from "@/components/secret-reveal";
import { Field } from "@/components/ui/field";
import { notifyError, notifySuccess } from "@/lib/notify";

type Stage = "intro" | "revealed";

async function post(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json().catch(() => null)) as {
    recoveryKey?: string;
    confirmed?: boolean;
    error?: string;
  } | null;

  if (!response.ok) throw new Error(data?.error ?? "Something went wrong.");
  return data;
}

export function RecoveryKeyFlow({
  alreadyGenerated,
}: {
  alreadyGenerated: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("intro");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const data = await post("/api/v1/recovery-key");
      if (!data?.recoveryKey) throw new Error("No recovery key was returned.");
      setRecoveryKey(data.recoveryKey);
      setEntry("");
      setStage("revealed");
    } catch (caught) {
      notifyError(
        "Could not generate a recovery key",
        (caught as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await post("/api/v1/recovery-key/confirm", { recoveryKey: entry });
      notifySuccess(
        "Recovery key confirmed",
        "Keep it somewhere you can find it.",
      );
      router.replace("/dashboard");
      router.refresh();
    } catch (caught) {
      notifyError("That did not match", (caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (stage === "intro") {
    return (
      <div className="space-y-4 rounded-lg border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">
            {alreadyGenerated
              ? "Generate a new recovery key"
              : "Generate your recovery key"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {alreadyGenerated
              ? "You generated one before but never confirmed it. Generating a new key replaces the old one, which stops working immediately."
              : "You will see it once. It is the only way back into your data if you forget your password."}
          </p>
        </div>
        <Button type="button" onClick={generate} disabled={busy}>
          {busy ? "Generating..." : "Generate recovery key"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-lg border bg-muted/40 p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Save this now</h2>
          <p className="text-sm text-muted-foreground">
            This is the only time it will be shown. Nobody — including this
            server — can recover it for you.
          </p>
        </div>
        {recoveryKey ? (
          <SecretReveal
            title="Billow recovery key"
            secret={recoveryKey}
            label="Recovery key"
            autoComplete="new-password"
            onePasswordType="login"
            notes="Recovery key for Billow. Needed to get back into your data if you forget your password."
          />
        ) : null}
      </div>

      <form
        className="space-y-4 rounded-lg border bg-card p-6"
        onSubmit={confirm}
        noValidate
      >
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Confirm you saved it</h2>
          <p className="text-sm text-muted-foreground">
            Type it back in. Spacing, dashes and capitalisation do not matter.
          </p>
        </div>
        <Field label="Recovery key" htmlFor="recoveryKeyEntry">
          <Input
            id="recoveryKeyEntry"
            type="text"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || entry.trim().length === 0}>
            {busy ? "Checking..." : "Confirm and continue"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={generate}
            disabled={busy}
          >
            Generate a different key
          </Button>
        </div>
      </form>
    </div>
  );
}
