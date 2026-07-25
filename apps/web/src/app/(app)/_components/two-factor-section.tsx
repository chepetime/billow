"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Stage = "idle" | "enrolling";

export function TwoFactorSection({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function reset() {
    setStage("idle");
    setPassword("");
    setCode("");
    setQrDataUrl(null);
    setBackupCodes([]);
    setIsPending(false);
  }

  async function handleEnable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsPending(true);

    const { data, error: enableError } = await authClient.twoFactor.enable({
      password,
    });

    if (enableError || !data) {
      setError(enableError?.message ?? "Unable to start two-factor setup.");
      setIsPending(false);
      return;
    }

    // Render the otpauth:// URI locally — no external requests.
    setQrDataUrl(await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 }));
    setBackupCodes(data.backupCodes ?? []);
    setPassword("");
    setStage("enrolling");
    setIsPending(false);
  }

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const { error: verifyError } = await authClient.twoFactor.verifyTotp({
      code,
    });

    if (verifyError) {
      setError(verifyError.message ?? "That code did not work.");
      setIsPending(false);
      return;
    }

    reset();
    setSuccess("Two-factor authentication is on.");
    router.refresh();
  }

  async function handleDisable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsPending(true);

    const { error: disableError } = await authClient.twoFactor.disable({
      password,
    });

    if (disableError) {
      setError(disableError.message ?? "Unable to turn off two-factor.");
      setIsPending(false);
      return;
    }

    reset();
    setSuccess("Two-factor authentication is off.");
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Two-factor authentication</h2>
        <p className="text-sm text-muted-foreground">
          {enabled
            ? "You'll be asked for a code from your authenticator app when signing in."
            : "Add a second step at sign-in using an authenticator app."}
        </p>
      </div>

      {stage === "enrolling" ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm">
              Scan this with your authenticator app, then enter the 6-digit code
              to confirm.
            </p>
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- inline data URI, no optimization needed
              <img
                src={qrDataUrl}
                alt="Two-factor QR code"
                className="rounded-md border bg-white p-2"
                width={220}
                height={220}
              />
            ) : null}
          </div>

          {backupCodes.length > 0 ? (
            <div className="space-y-2 rounded-md border bg-muted/40 p-4">
              <p className="text-sm font-medium">
                Save your backup codes — they won&apos;t be shown again.
              </p>
              <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
                {backupCodes.map((backupCode) => (
                  <li key={backupCode}>{backupCode}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={handleVerify} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="totpCode">Authentication code</Label>
              <Input
                id="totpCode"
                name="totpCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value.trim())}
              />
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Verifying..." : "Confirm and turn on"}
              </Button>
              <Button type="button" variant="outline" onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={enabled ? handleDisable : handleEnable}
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="twoFactorPassword">Confirm your password</Label>
            <Input
              id="twoFactorPassword"
              name="twoFactorPassword"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {success ? (
            <p className="text-sm text-muted-foreground">{success}</p>
          ) : null}

          <Button
            type="submit"
            variant={enabled ? "destructive" : "default"}
            disabled={isPending}
          >
            {isPending
              ? "Working..."
              : enabled
                ? "Turn off two-factor"
                : "Set up two-factor"}
          </Button>
        </form>
      )}
    </section>
  );
}
