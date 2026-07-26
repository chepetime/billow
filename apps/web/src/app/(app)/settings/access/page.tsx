import { RegistrationSection } from "@/app/(app)/settings/_components/registration-section";
import { requireSession } from "@/lib/auth-session";
import { getRegistrationEnabled } from "@/lib/registration-settings";

export const dynamic = "force-dynamic";

export default async function AccessSettingsPage() {
  await requireSession();
  const enabled = await getRegistrationEnabled();

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">Access</h1>
        <p className="text-sm text-muted-foreground">
          Control whether new accounts can join this Billow installation.
        </p>
      </div>
      <RegistrationSection enabled={enabled} />
    </div>
  );
}
