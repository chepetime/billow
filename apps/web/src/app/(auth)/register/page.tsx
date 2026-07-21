import Link from "next/link";

import { SignUpForm } from "@/app/(auth)/_components/sign-up-form";
import { buttonVariants } from "@/components/ui/button";
import { requireGuest } from "@/lib/auth-session";
import { canRegister } from "@/lib/registration";
import { getPrisma } from "@billow/db";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  await requireGuest();

  const userCount = await getPrisma().user.count();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        {canRegister(userCount) ? (
          <>
            <div className="space-y-1.5 text-center">
              <h1 className="text-2xl font-semibold tracking-normal">
                Create your Billow account
              </h1>
              <p className="text-sm text-muted-foreground">
                You&apos;re setting up the first and only account for this
                instance.
              </p>
            </div>

            <div className="rounded-lg border bg-card p-6">
              <SignUpForm />
            </div>
          </>
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
