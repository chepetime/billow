"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@billow/shadcn/components/button";
import { Field } from "@/components/ui/field";
import { Input } from "@billow/shadcn/components/input";

export function DeleteAccountSection() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function deleteAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);
    const response = await fetch("/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, confirmation }),
    });
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    setIsPending(false);

    if (!response.ok) {
      setError(result?.error ?? "Unable to delete your account.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-lg border border-destructive/30 bg-card p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-destructive">Delete account</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          This permanently removes your sign-in, API keys, invoices, clients,
          bank accounts, and sender profiles. This cannot be undone.
        </p>
      </div>

      <form className="space-y-4" onSubmit={deleteAccount} noValidate>
        <Field label="Current password" htmlFor="deletePassword">
          <Input
            id="deletePassword"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field
          label='Type DELETE to confirm'
          htmlFor="deleteConfirmation"
          hint="This action cannot be reversed."
        >
          <Input
            id="deleteConfirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </Field>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button
          type="submit"
          variant="destructive"
          disabled={isPending || confirmation !== "DELETE" || password.length === 0}
        >
          {isPending ? "Deleting account..." : "Delete account"}
        </Button>
      </form>
    </section>
  );
}
