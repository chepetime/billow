import { SignInForm } from "@/app/(auth)/_components/sign-in-form";
import { requireGuest } from "@/lib/auth-session";

export default async function LoginPage() {
  await requireGuest();

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
          <SignInForm />
        </div>
      </div>
    </main>
  );
}
