"use client";

import { authClient } from "@billow/auth/client";
import { Button } from "@billow/shadcn/components/button";
import { Input } from "@billow/shadcn/components/input";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Field } from "@/components/ui/field";
import {
  type ResetPasswordInput,
  resetPasswordSchema,
} from "@/lib/schemas/auth";

interface ResetPasswordFormProps {
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit({ password }: ResetPasswordInput) {
    setFormError(null);

    const { error } = await authClient.resetPassword({
      newPassword: password,
      token,
    });

    if (error) {
      setFormError(
        error.message ??
          "Could not reset the password. The link may have expired.",
      );
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Your password has been changed. Any other sessions that were signed in
          have been signed out.
        </p>
        <Button
          className="w-full"
          size="lg"
          onClick={() => {
            router.push("/login");
            router.refresh();
          }}
        >
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Field
        label="New password"
        htmlFor="password"
        error={errors.password?.message}
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          aria-invalid={Boolean(errors.password)}
          {...register("password")}
        />
      </Field>

      <Field
        label="Confirm new password"
        htmlFor="confirmPassword"
        error={errors.confirmPassword?.message}
      >
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.confirmPassword)}
          {...register("confirmPassword")}
        />
      </Field>

      {formError ? (
        <p className="space-y-1 text-sm text-destructive">
          {formError}{" "}
          <Link
            href="/forgot-password"
            className="underline underline-offset-4"
          >
            Request a new link
          </Link>
          .
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Saving..." : "Set new password"}
      </Button>
    </form>
  );
}
