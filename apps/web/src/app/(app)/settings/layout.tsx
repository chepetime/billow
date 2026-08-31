import { isAdmin, requireSession } from "@billow/auth";
import type { Metadata } from "next";
import { SettingsSidebar } from "@/app/(app)/settings/_components/settings-sidebar";

export const dynamic = "force-dynamic";

/**
 * Settings pages set a bare section name ("Security") and land as
 * "Security · Settings · Billow". The suffix is spelled out because a
 * template replaces the parent's rather than nesting inside it.
 */
export const metadata: Metadata = {
  title: {
    default: "Settings",
    template: "%s · Settings · Billow",
  },
};

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
