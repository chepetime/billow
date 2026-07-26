"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import QRCode from "qrcode";
import { useForm } from "react-hook-form";

import { Button } from "@billow/shadcn/components/button";
import { Field } from "@/components/ui/field";
import { Input } from "@billow/shadcn/components/input";
import { authClient } from "@/lib/auth-client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { twoFactorPasswordSchema, type TwoFactorPasswordInput } from "@/lib/schemas/account";
import { twoFactorCodeSchema, type TwoFactorCodeInput } from "@/lib/schemas/auth";

type Stage = "idle" | "enrolling";

export function TwoFactorSection({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const passwordForm = useForm<TwoFactorPasswordInput>({
    resolver: zodResolver(twoFactorPasswordSchema),
    defaultValues: { password: "" },
  });
  const codeForm = useForm<TwoFactorCodeInput>({
    resolver: zodResolver(twoFactorCodeSchema),
    defaultValues: { code: "" },
  });

  function reset() {
    setStage("idle");
    passwordForm.reset();
    codeForm.reset();
    setQrDataUrl(null);
    setBackupCodes([]);
  }

  async function enable({ password }: TwoFactorPasswordInput) {
    const { data, error: enableError } = await authClient.twoFactor.enable({ password });
    if (enableError || !data) {
      notifyError("Two-factor setup failed", enableError?.message ?? undefined);
      return;
    }
    setQrDataUrl(await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 }));
    setBackupCodes(data.backupCodes ?? []);
    passwordForm.reset();
    setStage("enrolling");
  }

  async function verify({ code }: TwoFactorCodeInput) {
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({ code });
    if (verifyError) {
      notifyError("That code did not work", verifyError.message ?? undefined);
      return;
    }
    reset();
    notifySuccess("Two-factor authentication is on", "Keep your backup codes somewhere safe.");
    router.refresh();
  }

  async function disable({ password }: TwoFactorPasswordInput) {
    const { error: disableError } = await authClient.twoFactor.disable({ password });
    if (disableError) {
      notifyError("Could not turn off two-factor", disableError.message ?? undefined);
      return;
    }
    reset();
    notifySuccess("Two-factor authentication is off");
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Two-factor authentication</h2>
        <p className="text-sm text-muted-foreground">{enabled ? "You'll be asked for a code from your authenticator app when signing in." : "Add a second step at sign-in using an authenticator app."}</p>
      </div>
      {stage === "enrolling" ? (
        <div className="space-y-4">
          <div className="space-y-2"><p className="text-sm">Scan this with your authenticator app, then enter the 6-digit code to confirm.</p>{qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- inline QR data URI needs no image optimization
            <img src={qrDataUrl} alt="Two-factor QR code" className="rounded-md border bg-white p-2" width={220} height={220} />
          ) : null}</div>
          {backupCodes.length > 0 ? <div className="space-y-2 rounded-md border bg-muted/40 p-4"><p className="text-sm font-medium">Save your backup codes — they won&apos;t be shown again.</p><ul className="grid grid-cols-2 gap-1 font-mono text-xs">{backupCodes.map((backupCode) => <li key={backupCode}>{backupCode}</li>)}</ul></div> : null}
          <form className="space-y-4" onSubmit={codeForm.handleSubmit(verify)} noValidate>
            <Field label="Authentication code" htmlFor="totpCode" error={codeForm.formState.errors.code?.message}><Input id="totpCode" type="text" inputMode="numeric" autoComplete="one-time-code" aria-invalid={Boolean(codeForm.formState.errors.code)} {...codeForm.register("code")} /></Field>
            <div className="flex gap-2"><Button type="submit" disabled={codeForm.formState.isSubmitting}>{codeForm.formState.isSubmitting ? "Verifying..." : "Confirm and turn on"}</Button><Button type="button" variant="outline" onClick={reset}>Cancel</Button></div>
          </form>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={passwordForm.handleSubmit(enabled ? disable : enable)} noValidate>
          <Field label="Confirm your password" htmlFor="twoFactorPassword" error={passwordForm.formState.errors.password?.message}><Input id="twoFactorPassword" type="password" autoComplete="current-password" aria-invalid={Boolean(passwordForm.formState.errors.password)} {...passwordForm.register("password")} /></Field>
          <Button type="submit" variant={enabled ? "destructive" : "default"} disabled={passwordForm.formState.isSubmitting}>{passwordForm.formState.isSubmitting ? "Working..." : enabled ? "Turn off two-factor" : "Set up two-factor"}</Button>
        </form>
      )}
    </section>
  );
}
