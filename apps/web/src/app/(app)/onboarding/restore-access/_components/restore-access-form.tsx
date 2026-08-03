"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@billow/shadcn/components/button";
import { Field } from "@/components/ui/field";
import { Input } from "@billow/shadcn/components/input";
import { notifyError, notifySuccess } from "@/lib/notify";

export function RestoreAccessForm() {
  const router = useRouter();
  const [recoveryKey, setRecoveryKey] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/v1/recovery-key/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryKey, password }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Something went wrong.");

      notifySuccess("Access restored", "Your data is readable again.");
      router.replace("/dashboard");
      router.refresh();
    } catch (caught) {
      notifyError("Could not restore access", (caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4 rounded-lg border bg-card p-6" onSubmit={submit} noValidate>
      <Field label="Recovery key" htmlFor="restoreRecoveryKey">
        <Input
          id="restoreRecoveryKey"
          type="text"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          value={recoveryKey}
          onChange={(event) => setRecoveryKey(event.target.value)}
        />
      </Field>
      <Field label="Your current password" htmlFor="restorePassword">
        <Input
          id="restorePassword"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <p className="text-sm text-muted-foreground">
        Your data key is re-wrapped under this password, so from here on signing
        in is enough. You will be asked to save a new recovery key afterwards.
      </p>
      <Button
        type="submit"
        disabled={busy || recoveryKey.trim().length === 0 || password.length === 0}
      >
        {busy ? "Restoring..." : "Restore access"}
      </Button>
    </form>
  );
}
