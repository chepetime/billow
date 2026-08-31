import { getSession, requireSession } from "@billow/auth";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { EncryptionNotice } from "@/app/(app)/_components/encryption-notice";
import { SenderForm } from "@/app/(app)/senders/_components/sender-form";
import { listSenderProfiles } from "@/lib/workspace-records";

export const dynamic = "force-dynamic";

/** Shared by `generateMetadata` and the page, so the lookup happens once. */
const loadProfiles = cache(listSenderProfiles);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await getSession();
  const { id } = await params;
  const profileId = Number.parseInt(id, 10);
  if (!session || Number.isNaN(profileId)) return { title: "Sender profile" };

  const { profiles } = await loadProfiles(session.user.id);
  const profile = profiles.find((candidate) => candidate.id === profileId);
  return { title: profile?.displayName ?? "Sender profile" };
}

export default async function EditSenderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const profileId = Number.parseInt(id, 10);

  if (Number.isNaN(profileId)) notFound();

  const { profiles, encrypted } = await loadProfiles(session.user.id);
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
