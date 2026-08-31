import { getSession, requireSession } from "@billow/auth";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { EncryptionNotice } from "@/app/(app)/_components/encryption-notice";
import { BankForm } from "@/app/(app)/banks/_components/bank-form";
import { listBankAccounts, listSenderProfiles } from "@/lib/workspace-records";

export const dynamic = "force-dynamic";

/** Shared by `generateMetadata` and the page, so the lookup happens once. */
const loadAccounts = cache(listBankAccounts);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await getSession();
  const { id } = await params;
  const accountId = Number.parseInt(id, 10);
  if (!session || Number.isNaN(accountId)) return { title: "Bank account" };

  const { accounts } = await loadAccounts(session.user.id);
  const account = accounts.find((candidate) => candidate.id === accountId);
  return { title: account?.label ?? "Bank account" };
}

export default async function EditBankPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const accountId = Number.parseInt(id, 10);

  if (Number.isNaN(accountId)) notFound();

  const [{ accounts, encrypted }, { profiles }] = await Promise.all([
    loadAccounts(session.user.id),
    listSenderProfiles(session.user.id),
  ]);
  const account = accounts.find((candidate) => candidate.id === accountId);

  if (!account) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/banks"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Bank accounts
      </Link>
      <h1 className="text-2xl font-semibold tracking-normal">
        {account.label}
      </h1>

      <EncryptionNotice encrypted={encrypted} />

      <BankForm
        id={account.id}
        senders={profiles.map((profile) => ({
          id: profile.id,
          displayName: profile.displayName,
        }))}
        defaultValues={{
          userProfileId: account.userProfileId,
          label: account.label,
          bankName: account.bankName,
          accountHolderName: account.accountHolderName,
          accountNumber: account.accountNumber,
          bankAddress: account.bankAddress ?? "",
          bankPhone: account.bankPhone ?? "",
          accountHolderAddress: account.accountHolderAddress ?? "",
          accountType: account.accountType ?? "",
          institutionNumber: account.institutionNumber ?? "",
          transitNumber: account.transitNumber ?? "",
          routingNumber: account.routingNumber ?? "",
          swift: account.swift ?? "",
          iban: account.iban ?? "",
          clabe: account.clabe ?? "",
          isDefault: account.isDefault,
        }}
      />
    </div>
  );
}
