import Link from "next/link";

import { ResetPasswordForm } from "@/app/(auth)/_components/reset-password-form";
import { buttonVariants } from "@billow/shadcn/components/button";
import { requireGuest } from "@billow/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Choose a new password" };

/**
 * Where the emailed link lands.
 *
 * The link in the message points at BetterAuth's own
 * `/api/auth/reset-password/<token>` endpoint, which checks the token exists
 * and has not expired, then redirects here with either `?token=` (valid) or
 * `?error=INVALID_TOKEN` (missing, unknown, or expired). So this page never
 * sees a token that failed that first check — but it must still handle the
 * error case, and the case of someone opening the bare URL.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  await requireGuest();

  const { token, error } = await searchParams;

  const shell = (title: string, description: string, body: React.ReactNode) => (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">{body}</div>
      </div>
    </main>
  );

  if (error || !token) {
    return shell(
      "That link is no longer valid",
      "Reset links expire after an hour and can only be used once.",
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Request a new one and we&apos;ll send another email.
        </p>
        <Link
          href="/forgot-password"
          className={buttonVariants({ size: "lg", className: "w-full" })}
        >
          Request a new link
        </Link>
        <Link
          href="/login"
          className={buttonVariants({ variant: "ghost", className: "w-full" })}
        >
          Back to sign in
        </Link>
      </div>,
    );
  }

  return shell(
    "Choose a new password",
    "Pick something you don't use anywhere else.",
    <ResetPasswordForm token={token} />,
  );
}
