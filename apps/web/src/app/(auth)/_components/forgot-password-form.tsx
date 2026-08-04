"use client";

import { authClient } from "@billow/auth/client";
import { Button, buttonVariants } from "@billow/shadcn/components/button";
import { Input } from "@billow/shadcn/components/input";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Field } from "@/components/ui/field";
import {
  type ForgotPasswordInput,
  forgotPasswordSchema,
} from "@/lib/schemas/auth";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit({ email }: ForgotPasswordInput) {
    setFormError(null);

    const { error } = await authClient.requestPasswordReset({
      email,
      // Relative on purpose: BetterAuth runs an origin check over this value,
      // and the emailed link is rewritten to whichever host the recipient can
      // actually reach (see lib/auth-mailer.ts).
      redirectTo: "/reset-password",
    });

    if (error) {
      setFormError(error.message ?? "Could not send the reset email.");
      return;
    }

    setSent(true);
  }

  // Shown whether or not the address belongs to an account: telling the
  // visitor which addresses exist would turn this form into a way to discover
  // who has an account here.
  if (sent) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          If that address belongs to an account, a reset link is on its way. The
          link expires in an hour and can only be used once.
        </p>
        <p className="text-sm text-muted-foreground">
          Nothing arrived? Check the spam folder, or ask an administrator
          whether email is set up on this installation.
        </p>
        <Link
          href="/login"
          className={buttonVariants({
            variant: "outline",
            className: "w-full",
          })}
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          aria-invalid={Boolean(errors.email)}
          {...register("email")}
        />
      </Field>

      {formError ? (
        <p className="text-sm text-destructive">{formError}</p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Sending..." : "Send reset link"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link
          href="/login"
          className="text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
