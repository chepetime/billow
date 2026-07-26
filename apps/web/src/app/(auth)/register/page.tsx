import Link from "next/link";

import { SignUpForm } from "@/app/(auth)/_components/sign-up-form";
import { buttonVariants } from "@billow/shadcn/components/button";
import { requireGuest } from "@/lib/auth-session";
import { canRegister } from "@/lib/registration";
import { getRegistrationEnabled } from "@/lib/registration-settings";
import { getPrisma } from "@billow/db";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  await requireGuest();

  let userCount: number | null = null;
  try {
    userCount = await getPrisma().user.count();
  } catch {
    // Fail closed while the registration guard cannot inspect the database.
    // The database hook remains the authoritative first-user-only check.
  }

  const registrationEnabled = await getRegistrationEnabled().catch(() => false);
  const registrationOpen =
    userCount !== null &&
    canRegister(userCount, registrationEnabled);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        {registrationOpen ? (
          <>
            <div className="space-y-1.5 text-center">
              <h1 className="text-2xl font-semibold tracking-normal">
                Create your Billow account
              </h1>
              <p className="text-sm text-muted-foreground">
                Create an account for your personal invoice workspace.
              </p>
            </div>

            <div className="rounded-lg border bg-card p-6">
              <SignUpForm />
            </div>
          </>
        ) : userCount === null ? (
          <div className="space-y-4 rounded-lg border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Registration is temporarily unavailable while Billow reconnects.
            </p>
            <Link
              href="/health"
              className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })}
            >
              Check service health
            </Link>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Billow is already set up.
            </p>
            <Link
              href="/login"
              className={buttonVariants({ size: "lg", className: "w-full" })}
            >
              Sign in
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
