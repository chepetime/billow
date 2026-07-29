"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@billow/shadcn/components/button";
import { Field } from "@/components/ui/field";
import { Input } from "@billow/shadcn/components/input";
import { authClient } from "@billow/auth/client";
import { isEmailIdentifier } from "@/lib/login-identifier";
import { signInSchema, type SignInInput } from "@/lib/schemas/auth";

export function SignInForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { identifier: "", password: "" },
  });

  async function onSubmit({ identifier, password }: SignInInput) {
    setFormError(null);

    const { data, error } = isEmailIdentifier(identifier)
      ? await authClient.signIn.email({ email: identifier, password })
      : await authClient.signIn.username({ username: identifier, password });

    if (error) {
      setFormError(error.message ?? "Unable to sign in.");
      return;
    }

    // With two-factor enabled, BetterAuth withholds the session and asks for a
    // second factor instead of signing in.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.push("/two-factor");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Field
        label="Username or email"
        htmlFor="identifier"
        error={errors.identifier?.message}
      >
        <Input
          id="identifier"
          type="text"
          autoComplete="username"
          aria-invalid={Boolean(errors.identifier)}
          {...register("identifier")}
        />
      </Field>

      <Field label="Password" htmlFor="password" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password)}
          {...register("password")}
        />
      </Field>

      <p className="text-right text-sm">
        <Link
          href="/forgot-password"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Forgot your password?
        </Link>
      </p>

      {formError ? (
        <p className="text-sm text-destructive">{formError}</p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Signing in..." : "Sign in"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Need an account?{" "}
        <Link
          href="/register"
          className="text-primary underline-offset-4 hover:underline"
        >
          Register
        </Link>
      </p>
    </form>
  );
}
