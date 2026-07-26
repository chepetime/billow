import { SettingsSidebar } from "@/app/(app)/settings/_components/settings-sidebar";

export default function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-1 flex-col gap-8 lg:flex-row lg:gap-10">
      <SettingsSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
