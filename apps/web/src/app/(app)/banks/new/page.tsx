import { requireSession } from "@billow/auth";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BankForm } from "@/app/(app)/banks/_components/bank-form";
import { listSenderProfiles } from "@/lib/workspace-records";

export const metadata: Metadata = {
  title: "New bank account",
};

export const dynamic = "force-dynamic";

export default async function NewBankPage() {
  const session = await requireSession();
  const { profiles } = await listSenderProfiles(session.user.id);

  // The form's sender select would be empty, and an account has nothing to
  // hang off. The list page explains this; here there is nothing to show.
  if (profiles.length === 0) redirect("/banks");

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/banks"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Bank accounts
      </Link>
      <h1 className="text-2xl font-semibold tracking-normal">
        New bank account
      </h1>
      <BankForm
        senders={profiles.map((profile) => ({
          id: profile.id,
          displayName: profile.displayName,
        }))}
      />
    </div>
  );
}
