import { TwoFactorSection } from "@/app/(app)/_components/two-factor-section";
import { requireSession } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const session = await requireSession();
  const user = session.user as typeof session.user & {
    twoFactorEnabled?: boolean | null;
  };

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">Security</h1>
        <p className="text-sm text-muted-foreground">
          Protect your account with an additional sign-in step.
        </p>
      </div>

      <TwoFactorSection enabled={Boolean(user.twoFactorEnabled)} />
    </div>
  );
}
