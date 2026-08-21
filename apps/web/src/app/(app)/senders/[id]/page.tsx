import { requireSession } from "@billow/auth";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EncryptionNotice } from "@/app/(app)/_components/encryption-notice";
import { SenderForm } from "@/app/(app)/senders/_components/sender-form";
import { listSenderProfiles } from "@/lib/workspace-records";

export const dynamic = "force-dynamic";

export default async function EditSenderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const profileId = Number.parseInt(id, 10);

  if (Number.isNaN(profileId)) notFound();

  const { profiles, encrypted } = await listSenderProfiles(session.user.id);
  const profile = profiles.find((candidate) => candidate.id === profileId);

  if (!profile) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/senders"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Sender profiles
      </Link>
      <h1 className="text-2xl font-semibold tracking-normal">
        {profile.displayName}
      </h1>

      <EncryptionNotice encrypted={encrypted} />

      <SenderForm
        id={profile.id}
        defaultValues={{
          displayName: profile.displayName,
          legalName: profile.legalName,
          email: profile.email,
          address: profile.address,
          taxId: profile.taxId ?? "",
          department: profile.department ?? "",
          manager: profile.manager ?? "",
        }}
      />
    </div>
  );
}
