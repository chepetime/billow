import { redirect } from "next/navigation";

import { getRecoveryKeyState, needsRecoveryKey, requireSession } from "@billow/auth";
import { RecoveryKeyFlow } from "./_components/recovery-key-flow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recovery key" };

export default async function RecoveryKeyPage() {
  const session = await requireSession();
  const state = await getRecoveryKeyState(session.user.id);

  // Nothing to protect yet, or already done. Either way this page has no job,
  // and the layout would otherwise bounce straight back here.
  if (!needsRecoveryKey(state)) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your recovery key</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your data is encrypted with a key only your password opens. If you
          forget that password, this recovery key is the only way back in —
          there is no reset that can rescue it for you.
        </p>
      </div>
      <RecoveryKeyFlow alreadyGenerated={Boolean(state.generatedAt)} />
    </div>
  );
}
