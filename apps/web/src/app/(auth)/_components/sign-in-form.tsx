"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { isEmailIdentifier } from "@/lib/login-identifier";

export function SignInForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const { data, error: signInError } = isEmailIdentifier(identifier)
      ? await authClient.signIn.email({ email: identifier, password })
      : await authClient.signIn.username({ username: identifier, password });

    if (signInError) {
      setError(signInError.message ?? "Unable to sign in.");
      setIsPending(false);
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
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="identifier">Username or email</Label>
        <Input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          required
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? "Signing in..." : "Sign in"}
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
