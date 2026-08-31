import { requireGuest } from "@billow/auth";
import { getEmailCapability } from "@billow/email";
import type { Metadata } from "next";
import { SignInForm } from "@/app/(auth)/_components/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  await requireGuest();

  // Fails closed on any read problem, so a database hiccup hides the link
  // rather than offering recovery this installation cannot deliver.
  const { canSendUserEmail } = await getEmailCapability();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-normal">
            Sign in to Billow
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter your credentials to continue.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <SignInForm canResetPassword={canSendUserEmail} />
        </div>
      </div>
    </main>
  );
}
