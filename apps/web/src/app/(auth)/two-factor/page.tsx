import { TwoFactorForm } from "@/app/(auth)/_components/two-factor-form";

export const dynamic = "force-dynamic";

export default function TwoFactorPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-normal">
            Two-factor authentication
          </h1>
          <p className="text-sm text-muted-foreground">
            Confirm it&apos;s you to finish signing in.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <TwoFactorForm />
        </div>
      </div>
    </main>
  );
}
