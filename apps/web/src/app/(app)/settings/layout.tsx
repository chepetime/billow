import { SettingsSidebar } from "@/app/(app)/settings/_components/settings-sidebar";
import { isAdmin } from "@/lib/admin";
import { requireSession } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireSession();
  const admin = isAdmin(session.user as { role?: string | null });

  return (
    <div className="flex flex-1 flex-col gap-8 lg:flex-row lg:gap-10">
      <SettingsSidebar isAdmin={admin} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
