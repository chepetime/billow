import { AccountForm } from "@/app/(app)/_components/account-form";
import { requireSession } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const session = await requireSession();
  const user = session.user as typeof session.user & {
    username?: string | null;
  };

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">Account</h1>
        <p className="text-sm text-muted-foreground">
          Update your profile, email address, and password.
        </p>
      </div>

      <AccountForm
        name={user.name}
        email={user.email}
        username={user.username ?? null}
      />
    </div>
  );
}
