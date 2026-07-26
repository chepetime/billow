import Link from "next/link";

import { UserMenu } from "@/app/(app)/_components/user-menu";
import { requireSession } from "@billow/auth";

export const dynamic = "force-dynamic";

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
