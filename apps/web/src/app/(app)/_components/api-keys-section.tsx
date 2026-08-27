"use client";

import { authClient } from "@billow/auth/client";
import { Button } from "@billow/shadcn/components/button";
import { Input } from "@billow/shadcn/components/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { SecretReveal } from "@/components/secret-reveal";
import { Field } from "@/components/ui/field";
import { createApiKey } from "@/lib/actions/api-keys";
import { describeGrant, grantOf } from "@/lib/api/api-key-scope";
import { notifyError, notifySuccess } from "@/lib/notify";
import {
  type CreateApiKeyFormValues,
  type CreateApiKeyInput,
  createApiKeySchema,
} from "@/lib/schemas/api-keys";

export type ApiKeySummary = {
  id: string;
  name?: string | null;
  start?: string | null;
  createdAt: Date | string;
  lastRequest?: Date | string | null;
  permissions?: unknown;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "never";
  return dateFormatter.format(new Date(value));
}

export function ApiKeysSection({ keys }: { keys: ApiKeySummary[] }) {
  const router = useRouter();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdKeyName, setCreatedKeyName] = useState<string>("");
  const form = useForm<CreateApiKeyFormValues, unknown, CreateApiKeyInput>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: { name: "", grant: "read" },
  });

  // Creation goes through a server action, not authClient: BetterAuth treats
  // `permissions` as server-only, so a key created from the browser would
  // carry no scope at all.
  async function createKey(values: CreateApiKeyInput) {
    setCreatedKey(null);
    const result = await createApiKey(values);
    if (!result.ok) {
      notifyError("Key not created", result.error);
      return;
    }
    setCreatedKey(result.data.key);
    setCreatedKeyName(result.data.name);
    form.reset({ name: "", grant: "read" });
    notifySuccess("API key created", "Save it now — it won't be shown again.");
    router.refresh();
  }

  async function handleRevoke(id: string) {
    const { error: deleteError } = await authClient.apiKey.delete({
      keyId: id,
    });
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
          Personal keys let other services call the Billow API on your behalf.
          Send one as an <code className="font-mono">x-api-key</code> header —
          try <code className="font-mono">GET /api/v1/me</code>.
        </p>
      </div>
      {createdKey ? (
        <div className="space-y-3 rounded-md border bg-muted/40 p-4">
          <p className="text-sm font-medium">
            Save your key now — it won&apos;t be shown again.
          </p>
          <SecretReveal
            title={`Billow API key${createdKeyName ? ` — ${createdKeyName}` : ""}`}
            secret={createdKey}
            label="API key"
            autoComplete="new-password"
            onePasswordType="api-key"
            notes="Send this as an x-api-key header to call the Billow API."
          />
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={form.handleSubmit(createKey)}
        noValidate
      >
        <Field
          label="Key name"
          htmlFor="keyName"
          error={form.formState.errors.name?.message}
          className="flex-1"
        >
          <Input
            id="keyName"
            type="text"
            placeholder="Personal key"
            aria-invalid={Boolean(form.formState.errors.name)}
            {...form.register("name")}
          />
        </Field>
        <Field label="Access" htmlFor="keyGrant" className="w-48">
          <select
            id="keyGrant"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            {...form.register("grant")}
          >
            <option value="read">Read only</option>
            <option value="read_write">Read and write</option>
          </select>
        </Field>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Creating..." : "Create key"}
        </Button>
      </form>
      {keys.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {key.name || "Untitled key"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {key.start ? (
                    <span className="font-mono">{key.start}…</span>
                  ) : null}{" "}
                  {describeGrant(grantOf(key.permissions))} · created{" "}
                  {formatDate(key.createdAt)} · last used{" "}
                  {formatDate(key.lastRequest)}
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => handleRevoke(key.id)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No API keys yet.</p>
      )}
    </section>
  );
}
