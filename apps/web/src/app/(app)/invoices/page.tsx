import { requireSession } from "@billow/auth";
import { buttonVariants } from "@billow/shadcn/components/button";
import type { Metadata } from "next";
import Link from "next/link";

import { InvoiceStatusBadge } from "@/components/ui/badge";
import { formatCurrency, formatInvoiceDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { INVOICE_PAGE_SIZE, listInvoices } from "@/lib/workspace/invoices";

export const metadata: Metadata = {
  title: "Invoices",
};

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const session = await requireSession();
  const result = await listInvoices(session.user.id);
  // A page throws where the API answers 500: the read already logged its
  // cause, and an empty list would say something false about the account.
  if (!result.ok) throw new Error("Could not load invoices.");
  const { invoices, count, truncated } = result.data;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-normal">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            {count === 0
              ? "Nothing here yet."
              : `${count} invoice${count === 1 ? "" : "s"}.`}
          </p>
        </div>
        <Link href="/invoices/new" className={cn(buttonVariants())}>
          New invoice
        </Link>
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-sm font-medium">No invoices yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first one. Billow suggests the next number and defaults
            the date to the end of this month.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border bg-card">
          {invoices.map((invoice) => (
            <li key={invoice.publicId}>
              <Link
                href={`/invoices/${invoice.publicId}`}
                className="flex flex-wrap items-center justify-between gap-3 p-5 hover:bg-accent/40"
              >
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium">#{invoice.invoiceNumber}</span>
                  <span className="text-muted-foreground">
                    {invoice.clientCompany.name}
                  </span>
                  <span className="text-muted-foreground">
                    {formatInvoiceDate(invoice.invoiceDate)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-medium tabular-nums">
                    {formatCurrency(invoice.total, invoice.currency)}
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

      {truncated && (
        <p className="text-sm text-muted-foreground">
          Showing the {INVOICE_PAGE_SIZE} most recent of {count}.
        </p>
      )}
    </div>
  );
}
