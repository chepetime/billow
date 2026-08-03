import Link from "next/link";

import { OnboardingGate } from "@/app/(app)/_components/onboarding-gate";
import { UserMenu } from "@/app/(app)/_components/user-menu";
import {
  getRecoveryKeyState,
  needsAccessRestored,
  needsRecoveryKey,
  requireSession,
} from "@billow/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireSession();
  const keyState = await getRecoveryKeyState(session.user.id, session.session.id).catch(
    () => null,
  );

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      {/*
        Only gates accounts that actually have a keyset. One that does not —
        signed in before keysets existed, or a failed lookup — has nothing a
        recovery key could protect, so sending it here would be a dead end.
      */}
      <OnboardingGate
        needsRestore={needsAccessRestored(keyState)}
        needsRecoveryKey={needsRecoveryKey(keyState)}
      />
      <header className="border-b print:hidden">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-6 py-4 sm:px-8">
          <Link href="/dashboard" className="text-sm font-medium hover:text-muted-foreground">
            Home
          </Link>

          <UserMenu
            name={session.user.name}
            email={session.user.email}
            image={session.user.image ?? null}
          />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10 sm:px-8">
        {children}
      </main>
    </div>
  );
}
