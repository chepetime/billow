import { ForgotPasswordForm } from "@/app/(auth)/_components/forgot-password-form";
import { requireGuest } from "@billow/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage() {
  await requireGuest();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-normal">
            Reset your password
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send you a link to choose a new
            password.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <ForgotPasswordForm />
        </div>
      </div>
    </main>
  );
}
