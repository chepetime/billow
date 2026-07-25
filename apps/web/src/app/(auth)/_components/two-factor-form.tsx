"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function TwoFactorForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const { error: verifyError } = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });

    if (verifyError) {
      setError(verifyError.message ?? "That code did not work.");
      setIsPending(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="code">
          {useBackupCode ? "Backup code" : "Authentication code"}
        </Label>
        <Input
          id="code"
          name="code"
          type="text"
          inputMode={useBackupCode ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoFocus
          required
          value={code}
          onChange={(event) => setCode(event.target.value.trim())}
        />
        <p className="text-xs text-muted-foreground">
          {useBackupCode
            ? "Each backup code can only be used once."
            : "Enter the 6-digit code from your authenticator app."}
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? "Verifying..." : "Verify"}
      </Button>

      <button
        type="button"
        className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        onClick={() => {
          setUseBackupCode((previous) => !previous);
          setCode("");
          setError(null);
        }}
      >
        {useBackupCode
          ? "Use your authenticator app instead"
          : "Use a backup code instead"}
      </button>
    </form>
  );
}
