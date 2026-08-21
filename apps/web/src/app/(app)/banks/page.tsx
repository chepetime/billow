import { requireSession } from "@billow/auth";
import { buttonVariants } from "@billow/shadcn/components/button";
import Link from "next/link";

import { EncryptionNotice } from "@/app/(app)/_components/encryption-notice";
import { maskAccountNumber } from "@/lib/mask";
import { cn } from "@/lib/utils";
import { listBankAccounts, listSenderProfiles } from "@/lib/workspace-records";

export const dynamic = "force-dynamic";

export default async function BanksPage() {
  const session = await requireSession();
  const [{ accounts, encrypted }, { profiles }] = await Promise.all([
    listBankAccounts(session.user.id),
    listSenderProfiles(session.user.id),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-normal">
            Bank accounts
          </h1>
          <p className="text-sm text-muted-foreground">
            Payment instructions. Shown in full on the invoice, masked here.
          </p>
        </div>
        {profiles.length > 0 && (
          <Link href="/banks/new" className={cn(buttonVariants())}>
            New account
          </Link>
        )}
      </div>

      <EncryptionNotice encrypted={encrypted} />

      {profiles.length === 0 ? (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-sm font-medium">Add a sender profile first</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A bank account belongs to a sender.{" "}
            <Link
              href="/senders/new"
              className="text-primary underline-offset-4 hover:underline"
            >
              Create one
            </Link>
            , then come back.
          </p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-sm font-medium">No bank accounts yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the account your clients pay into. It becomes the payment
            instructions block on every invoice.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border bg-card">
          {accounts.map((account) => (
            <li key={account.id}>
              <Link
                href={`/banks/${account.id}`}
                className="flex flex-wrap items-center justify-between gap-3 p-5 hover:bg-accent/40"
              >
                <div className="space-y-0.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{account.label}</span>
                    {account.isDefault && (
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground">{account.bankName}</p>
                  <p className="text-muted-foreground">
                    {maskAccountNumber(account.accountNumber)} ·{" "}
                    {account.userProfile.displayName}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">Edit</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
