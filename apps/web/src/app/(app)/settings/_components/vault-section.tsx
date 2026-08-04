"use client";

import { Button } from "@billow/shadcn/components/button";
import { Input } from "@billow/shadcn/components/input";
import { Textarea } from "@billow/shadcn/components/textarea";
import { useState, useSyncExternalStore } from "react";
import { Field } from "@/components/ui/field";
import { notifyError, notifySuccess } from "@/lib/notify";

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "The vault request failed.";
}

/**
 * A deliberately small, experimental proving ground for encrypted-at-rest
 * data. The key remains in this form's memory and is sent only in the request
 * header that needs it; it is never saved in a cookie, local storage, or DB.
 *
 * It is still sent over whatever transport the page was loaded on, and Umbrel
 * serves this app over plain HTTP by default — see the transport warning below,
 * which is shown only when the connection is actually insecure.
 */
export function VaultSection() {
  const [vaultKey, setVaultKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<"save" | "unlock" | "delete" | null>(null);
  // Read from the browser rather than held in state: the value never changes
  // for the life of the page, so there is nothing to synchronise. The server
  // snapshot is `false` so an HTTPS install does not flash a warning before
  // hydration.
  //
  // `isSecureContext` is the browser's own judgement and already treats
  // localhost as secure, which is what keeps `pnpm dev:local` warning-free
  // without a special case here.
  const insecureTransport = useSyncExternalStore(
    () => () => {},
    () => !window.isSecureContext,
    () => false,
  );

  function requestHeaders() {
    return {
      "Content-Type": "application/json",
      "x-billow-vault-key": vaultKey,
    };
  }

  async function save() {
    if (!vaultKey || !secret) {
      notifyError("Enter both a vault key and a note.");
      return;
    }

    setBusy("save");
    try {
      const response = await fetch("/api/v1/vault", {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({ secret }),
      });
      if (!response.ok)
        return notifyError("Vault not saved", await readError(response));
      setSecret("");
      notifySuccess("Vault entry encrypted and saved");
    } catch {
      notifyError("Vault not saved", "Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function unlock() {
    if (!vaultKey) {
      notifyError("Enter the vault key first.");
      return;
    }

    setBusy("unlock");
    try {
      const response = await fetch("/api/v1/vault", {
        headers: requestHeaders(),
      });
      if (!response.ok)
        return notifyError("Vault remains locked", await readError(response));
      const payload = (await response.json()) as { secret: string };
      setSecret(payload.secret);
      notifySuccess(
        "Vault unlocked",
        "The decrypted note is only in this page's memory.",
      );
    } catch {
      notifyError("Vault remains locked", "Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      const response = await fetch("/api/v1/vault", { method: "DELETE" });
      if (!response.ok)
        return notifyError(
          "Vault entry not deleted",
          await readError(response),
        );
      setSecret("");
      notifySuccess("Vault entry deleted");
    } catch {
      notifyError("Vault entry not deleted", "Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-5 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Experimental data vault</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Save one private note as AES-256-GCM ciphertext. Your vault key is
          never stored and is required again to read the note — lose it and the
          note is gone. This is a security test, not a recovery-ready feature.
        </p>
      </div>

      {insecureTransport ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm leading-6">
          This page is not on a secure connection, so the vault key is sent
          across your network in the clear every time you save or unlock. Anyone
          who can watch that traffic can read it. Encryption at rest still holds
          — a database dump stays useless on its own — but reach Billow over
          HTTPS before putting anything you actually care about here.
        </p>
      ) : null}

      <Field label="Vault key" htmlFor="vault-key">
        <Input
          id="vault-key"
          type="password"
          autoComplete="off"
          value={vaultKey}
          onChange={(event) => setVaultKey(event.target.value)}
        />
      </Field>

      <Field label="Private note" htmlFor="vault-secret">
        <Textarea
          id="vault-secret"
          value={secret}
          maxLength={4096}
          placeholder="A secret to test against the database dump"
          onChange={(event) => setSecret(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy !== null}
          onClick={() => void save()}
        >
          {busy === "save" ? "Encrypting…" : "Encrypt and save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void unlock()}
        >
          {busy === "unlock" ? "Unlocking…" : "Unlock"}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={busy !== null}
          onClick={() => void remove()}
        >
          {busy === "delete" ? "Deleting…" : "Delete vault entry"}
        </Button>
      </div>

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-muted-foreground">
        A database dump contains ciphertext only. A self-hosted administrator
        who changes the running app can still capture a vault key while it is
        entered; this lab does not claim to defend against that threat.
      </p>
    </section>
  );
}
