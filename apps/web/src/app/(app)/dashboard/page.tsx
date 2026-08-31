import { requireSession } from "@billow/auth";
import { buttonVariants } from "@billow/shadcn/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@billow/shadcn/components/card";
import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceStatusBadge } from "@/components/ui/badge";
import { formatInvoiceDate, formatMoney } from "@/lib/format";
import { getInvoiceWorkspace } from "@/lib/invoice-workspace";
import { maskAccountNumber } from "@/lib/mask";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Dashboard",
};
export default async function DashboardPage() {
  const session = await requireSession();
  const workspace = await getInvoiceWorkspace(session.user.id);

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-normal">
            Welcome back, {session.user.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Here&apos;s what&apos;s happening with your invoices.
          </p>
        </div>
        {workspace.hasWorkspace && (
          <Link href="/invoices/new" className={cn(buttonVariants())}>
            New invoice
          </Link>
        )}
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
            Before you can create invoices, Billow needs a few things in place.
          </p>
          <ul className="mt-4 space-y-3">
            {[
              {
                label: "A sender profile",
                done: workspace.userProfiles.length > 0,
                href: "/senders/new",
                cta: "Add a sender",
              },
              {
                label: "At least one bank account",
                done: workspace.bankAccounts.length > 0,
                href: "/banks/new",
                cta: "Add an account",
              },
              {
                label: "A client company",
                done: workspace.clientCompanies.length > 0,
                href: "/clients/new",
                cta: "Add a client",
              },
            ].map((step) => (
              <li
                key={step.href}
                className="flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                <span
                  className={
                    step.done ? "text-muted-foreground line-through" : undefined
                  }
                >
                  {step.label}
                </span>
                {step.done ? (
                  <span className="text-muted-foreground">Done</span>
                ) : (
                  <Link
                    href={step.href}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {step.cta}
                  </Link>
                )}
              </li>
            ))}
          </ul>
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

          <Card>
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
              <CardDescription>
                The next missing fact or document for each active invoice and
                this month&apos;s tax filing.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {workspace.attention.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing needs attention right now.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {workspace.attention.map((item) => (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        className="flex min-h-11 items-center justify-between gap-4 py-3"
                      >
                        <span className="font-medium">{item.title}</span>
                        <span className="text-right text-sm text-muted-foreground">
                          {item.detail}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="rounded-lg border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">Recent invoices</h2>
              <Link
                href="/invoices"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                View all
              </Link>
            </div>
            {workspace.recentInvoices.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No invoices yet.
              </p>
            ) : (
              // No slice: the query is already bounded to what this list
              // shows. The stat tiles above cover every invoice, not these.
              <ul className="mt-3 divide-y divide-border">
                {workspace.recentInvoices.map((invoice) => (
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
                        <InvoiceStatusBadge
                          status={invoice.status}
                          sentAt={invoice.sentAt}
                        />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">Bank accounts</h2>
                <Link
                  href="/banks"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Manage
                </Link>
              </div>
              {workspace.bankAccounts.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  No bank accounts yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {workspace.bankAccounts.map((bankAccount) => (
                    <li key={bankAccount.id} className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{bankAccount.label}</span>
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
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">Client companies</h2>
                <Link
                  href="/clients"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Manage
                </Link>
              </div>
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
