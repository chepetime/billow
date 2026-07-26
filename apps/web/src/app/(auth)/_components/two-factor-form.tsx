"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@billow/shadcn/components/button";
import { Field } from "@/components/ui/field";
import { Input } from "@billow/shadcn/components/input";
import { authClient } from "@/lib/auth-client";
import {
  twoFactorCodeSchema,
  type TwoFactorCodeInput,
} from "@/lib/schemas/auth";

export function TwoFactorForm() {
  const router = useRouter();
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TwoFactorCodeInput>({
    resolver: zodResolver(twoFactorCodeSchema),
    defaultValues: { code: "" },
  });

  async function onSubmit({ code }: TwoFactorCodeInput) {
    setFormError(null);
    const trimmed = code.trim();

    const { error } = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code: trimmed })
      : await authClient.twoFactor.verifyTotp({ code: trimmed });

    if (error) {
      setFormError(error.message ?? "That code did not work.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Field
        label={useBackupCode ? "Backup code" : "Authentication code"}
        htmlFor="code"
        error={errors.code?.message}
        hint={
          useBackupCode
            ? "Each backup code can only be used once."
            : "Enter the 6-digit code from your authenticator app."
        }
      >
        <Input
          id="code"
          type="text"
          inputMode={useBackupCode ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoFocus
          aria-invalid={Boolean(errors.code)}
          {...register("code")}
        />
      </Field>

      {formError ? (
        <p className="text-sm text-destructive">{formError}</p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Verifying..." : "Verify"}
      </Button>

      <button
        type="button"
        className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        onClick={() => {
          setUseBackupCode((previous) => !previous);
          setFormError(null);
          reset({ code: "" });
        }}
      >
        {useBackupCode
          ? "Use your authenticator app instead"
          : "Use a backup code instead"}
      </button>
    </form>
  );
}
