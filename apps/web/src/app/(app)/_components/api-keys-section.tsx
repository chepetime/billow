"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Button } from "@billow/shadcn/components/button";
import { Field } from "@/components/ui/field";
import { Input } from "@billow/shadcn/components/input";
import { authClient } from "@/lib/auth-client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { CopyButton } from "@/components/motion/copy-button";
import { createApiKeySchema, type CreateApiKeyInput } from "@/lib/schemas/api-keys";

export type ApiKeySummary = {
  id: string;
  name?: string | null;
  start?: string | null;
  createdAt: Date | string;
  lastRequest?: Date | string | null;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "never";
  return dateFormatter.format(new Date(value));
}

export function ApiKeysSection({ keys }: { keys: ApiKeySummary[] }) {
  const router = useRouter();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const form = useForm<CreateApiKeyInput>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: { name: "" },
  });

  async function createKey({ name }: CreateApiKeyInput) {
    setCreatedKey(null);
    const { data, error: createError } = await authClient.apiKey.create({ name: name || "Personal key" });
    if (createError || !data) {
      notifyError("Key not created", createError?.message ?? undefined);
      return;
    }
    setCreatedKey(data.key);
    form.reset();
    notifySuccess("API key created", "Copy it now — it won't be shown again.");
    router.refresh();
  }

  async function handleRevoke(id: string) {
    const { error: deleteError } = await authClient.apiKey.delete({ keyId: id });
    if (deleteError) {
      notifyError("Key not revoked", deleteError.message ?? undefined);
      return;
    }
    notifySuccess("API key revoked");
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">API keys</h2>
        <p className="text-sm text-muted-foreground">
          Personal keys let other services call the Billow API on your behalf. Send one as an <code className="font-mono">x-api-key</code> header — try <code className="font-mono">GET /api/v1/me</code>.
        </p>
      </div>
      {createdKey ? (
        <div className="space-y-3 rounded-md border bg-muted/40 p-4">
          <p className="text-sm font-medium">
            Copy your key now — it won&apos;t be shown again.
          </p>
          <p className="font-mono text-xs break-all">{createdKey}</p>
          <CopyButton value={createdKey} label="Copy key" copiedLabel="Copied" />
        </div>
      ) : null}
      <form className="flex flex-wrap items-end gap-3" onSubmit={form.handleSubmit(createKey)} noValidate>
        <Field label="Key name" htmlFor="keyName" error={form.formState.errors.name?.message} className="flex-1">
          <Input id="keyName" type="text" placeholder="Personal key" aria-invalid={Boolean(form.formState.errors.name)} {...form.register("name")} />
        </Field>
        <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Creating..." : "Create key"}</Button>
      </form>
      {keys.length > 0 ? <ul className="divide-y rounded-md border">{keys.map((key) => <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div className="space-y-0.5"><p className="text-sm font-medium">{key.name || "Untitled key"}</p><p className="text-xs text-muted-foreground">{key.start ? <span className="font-mono">{key.start}…</span> : null}{" "}created {formatDate(key.createdAt)} · last used {formatDate(key.lastRequest)}</p></div><Button type="button" variant="destructive" size="sm" onClick={() => handleRevoke(key.id)}>Revoke</Button></li>)}</ul> : <p className="text-sm text-muted-foreground">No API keys yet.</p>}
    </section>
  );
}
