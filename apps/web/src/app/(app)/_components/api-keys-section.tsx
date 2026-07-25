"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export type ApiKeySummary = {
  id: string;
  name?: string | null;
  start?: string | null;
  createdAt: Date | string;
  lastRequest?: Date | string | null;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "never";
  return new Date(value).toLocaleDateString();
}

export function ApiKeysSection({ keys }: { keys: ApiKeySummary[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCreatedKey(null);
    setIsPending(true);

    const { data, error: createError } = await authClient.apiKey.create({
      name: name.trim() || "Personal key",
    });

    if (createError || !data) {
      setError(createError?.message ?? "Unable to create the key.");
      setIsPending(false);
      return;
    }

    setCreatedKey(data.key);
    setName("");
    setIsPending(false);
    router.refresh();
  }

  async function handleRevoke(id: string) {
    setError(null);
    const { error: deleteError } = await authClient.apiKey.delete({ keyId: id });
    if (deleteError) {
      setError(deleteError.message ?? "Unable to revoke the key.");
      return;
    }
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
        <div className="space-y-2 rounded-md border bg-muted/40 p-4">
          <p className="text-sm font-medium">
            Copy your key now — it won&apos;t be shown again.
          </p>
          <p className="font-mono text-xs break-all">{createdKey}</p>
        </div>
      ) : null}

      <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate}>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="keyName">Key name</Label>
          <Input
            id="keyName"
            name="keyName"
            type="text"
            placeholder="Personal key"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating..." : "Create key"}
        </Button>
      </form>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

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
                  created {formatDate(key.createdAt)} · last used{" "}
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
