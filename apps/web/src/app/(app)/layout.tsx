import Link from "next/link";

import { SignOutButton } from "@/app/(app)/_components/sign-out-button";
import { requireSession } from "@/lib/auth-session";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireSession();

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b print:hidden">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-6 py-4 sm:px-8">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-sm font-semibold">
              Billow
            </Link>
            <Link
              href="/settings"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Settings
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {session.user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10 sm:px-8">
        {children}
      </main>
    </div>
  );
}
