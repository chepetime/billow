import { redirect } from "next/navigation";

import { getRecoveryKeyState, needsAccessRestored, requireSession } from "@billow/auth";
import { RestoreAccessForm } from "./_components/restore-access-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Restore access" };

export default async function RestoreAccessPage() {
  const session = await requireSession();
  const state = await getRecoveryKeyState(session.user.id, session.session.id);

  if (!needsAccessRestored(state)) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Restore your access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your password changed without your old one — a reset, or an
          administrator setting it directly. That changes the password but not
          the key your data is encrypted with, so your recovery key is what puts
          the two back together.
        </p>
      </div>
      <RestoreAccessForm />
    </div>
  );
}
