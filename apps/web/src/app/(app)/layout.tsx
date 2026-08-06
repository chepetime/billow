import {
  getRecoveryKeyState,
  needsAccessRestored,
  needsRecoveryKey,
  requireSession,
} from "@billow/auth";
import Link from "next/link";
import { OnboardingGate } from "@/app/(app)/_components/onboarding-gate";
import { UserMenu } from "@/app/(app)/_components/user-menu";

export const dynamic = "force-dynamic";

/**
 * Plain links, not an active-state nav: making one would turn this server
 * layout into a client component for a highlight, and `usePathname` in a
 * separate island is more machinery than five links justify.
 */
const NAV_LINKS = [
  { href: "/dashboard", label: "Home" },
  { href: "/invoices", label: "Invoices" },
  { href: "/clients", label: "Clients" },
  { href: "/banks", label: "Banks" },
  { href: "/senders", label: "Senders" },
] as const;

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireSession();
  const keyState = await getRecoveryKeyState(
    session.user.id,
    session.session.id,
  ).catch(() => null);

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
          <nav className="flex items-center gap-4 overflow-x-auto text-sm">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="whitespace-nowrap font-medium hover:text-muted-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

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
