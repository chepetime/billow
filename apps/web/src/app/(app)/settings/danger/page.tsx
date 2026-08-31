import { requireSession } from "@billow/auth";
import type { Metadata } from "next";
import { DeleteAccountSection } from "@/app/(app)/settings/_components/delete-account-section";

export const metadata: Metadata = {
  title: "Danger zone",
};

export const dynamic = "force-dynamic";

export default async function DangerSettingsPage() {
  await requireSession();

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">Danger zone</h1>
        <p className="text-sm text-muted-foreground">
          Permanently remove your account and private workspace.
        </p>
      </div>
      <DeleteAccountSection />
    </div>
  );
}
