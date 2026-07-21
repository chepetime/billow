import { AccountForm } from "@/app/(app)/_components/account-form";
import { requireSession } from "@/lib/auth-session";

export default async function SettingsPage() {
  const session = await requireSession();

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">
          Account settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile and password.
        </p>
      </div>

      <AccountForm email={session.user.email} name={session.user.name} />
    </div>
  );
}
