import Link from "next/link";

import { InvoiceStatusBadge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth-session";
import {
  formatInvoiceDate,
  formatMoney,
  getInvoiceWorkspace,
} from "@/lib/invoice-workspace";

const RECENT_INVOICE_LIMIT = 8;

function maskAccountNumber(accountNumber: string) {
  const last4 = accountNumber.slice(-4);
  return `•••• ${last4}`;
}

export default async function DashboardPage() {
  const session = await requireSession();
  const workspace = await getInvoiceWorkspace();

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">
          Welcome back, {session.user.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s what&apos;s happening with your invoices.
        </p>
      </div>

      {!workspace.databaseAvailable ? (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-medium">Database unavailable</h2>
          <p className="mt-1 text-sm text-destructive">{workspace.error}</p>
        </div>
      ) : !workspace.hasWorkspace ? (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-medium">Set up your workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Before you can create invoices, Billow needs a few things in
            place:
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            <li>
              1. A sender profile ({workspace.userProfiles.length > 0 ? "done" : "not set up"})
            </li>
            <li>
              2. At least one bank account ({workspace.bankAccounts.length > 0 ? "done" : "not set up"})
            </li>
            <li>
              3. A client company ({workspace.clientCompanies.length > 0 ? "done" : "not set up"})
            </li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            Setup screens are coming soon.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Invoices
              </h2>
              <p className="mt-1 text-2xl font-semibold tracking-normal">
                {workspace.stats.invoiceCount}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-medium text-muted-foreground">
                This month
              </h2>
              <p className="mt-1 text-2xl font-semibold tracking-normal">
                {formatMoney(workspace.stats.currentTotal)}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Open
              </h2>
              <p className="mt-1 text-2xl font-semibold tracking-normal">
                {formatMoney(workspace.stats.openTotal)}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Paid
              </h2>
              <p className="mt-1 text-2xl font-semibold tracking-normal">
                {formatMoney(workspace.stats.paidTotal)}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-medium text-muted-foreground">
                Next invoice #
              </h2>
              <p className="mt-1 text-2xl font-semibold tracking-normal">
                {workspace.nextInvoiceNumber}
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-sm font-medium">Recent invoices</h2>
            {workspace.invoices.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No invoices yet.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {workspace.invoices
                  .slice(0, RECENT_INVOICE_LIMIT)
                  .map((invoice) => (
                    <li key={invoice.id} className="text-sm">
                      <Link
                        href={`/invoices/${invoice.id}`}
                        className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0 hover:text-foreground"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium">
                            #{invoice.invoiceNumber}
                          </span>
                          <span className="text-muted-foreground">
                            {invoice.clientCompany.name}
                          </span>
                          <span className="text-muted-foreground">
                            {formatInvoiceDate(invoice.invoiceDate)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-medium">
                            {formatMoney(invoice.total)}
                          </span>
                          <InvoiceStatusBadge status={invoice.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-medium">Bank accounts</h2>
              {workspace.bankAccounts.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  No bank accounts yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {workspace.bankAccounts.map((bankAccount) => (
                    <li key={bankAccount.id} className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {bankAccount.label}
                        </span>
                        {bankAccount.isDefault && (
                          <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                            Default
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-muted-foreground">
                        {bankAccount.bankName} · {bankAccount.accountHolderName}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        {maskAccountNumber(bankAccount.accountNumber)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-medium">Client companies</h2>
              {workspace.clientCompanies.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  No client companies yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {workspace.clientCompanies.map((clientCompany) => (
                    <li key={clientCompany.id} className="text-sm">
                      <p className="font-medium">{clientCompany.name}</p>
                      <p className="mt-0.5 text-muted-foreground">
                        {clientCompany.email}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      <p className="text-sm text-muted-foreground">
        Manage your account in{" "}
        <Link
          href="/settings"
          className="text-primary underline-offset-4 hover:underline"
        >
          Settings
        </Link>
        .
      </p>
    </div>
  );
}
