import { requireSession } from "@billow/auth";
import type { Metadata } from "next";
import Link from "next/link";

import { InvoiceForm } from "@/app/(app)/invoices/_components/invoice-form";
import { WorkspaceSetupNotice } from "@/app/(app)/invoices/_components/workspace-setup-notice";
import { endOfMonth } from "@/lib/date-only";
import { CURRENCIES } from "@/lib/schemas/workspace";
import { getInvoiceFormOptions } from "@/lib/workspace-records";

export const metadata: Metadata = {
  title: "New invoice",
};

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const session = await requireSession();
  const options = await getInvoiceFormOptions(session.user.id);

  // The defaults from the requirements: default bank account, most recently
  // used client, next number, month end, and the currency last used.
  const defaultAccount =
    options.accounts.find((account) => account.isDefault) ??
    options.accounts[0];
  const defaultClient =
    options.clients.find(
      (client) => client.id === options.mostRecentClientId,
    ) ?? options.clients[0];
  const defaultCurrency =
    options.mostRecentCurrency &&
    (CURRENCIES as readonly string[]).includes(options.mostRecentCurrency)
      ? options.mostRecentCurrency
      : "MXN";

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/invoices"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Invoices
      </Link>
      <h1 className="text-2xl font-semibold tracking-normal">New invoice</h1>

      {options.ready ? (
        <InvoiceForm
          options={options}
          defaultValues={{
            userProfileId: options.profiles[0]?.id ?? 0,
            bankAccountId: defaultAccount?.id ?? 0,
            clientCompanyId: defaultClient?.id ?? 0,
            invoiceNumber: options.nextInvoiceNumber,
            invoiceDate: endOfMonth(new Date()),
            currency: defaultCurrency as (typeof CURRENCIES)[number],
            status: "DRAFT",
            notes: "",
            lineItems: [{ description: "", note: "", quantity: 1, rate: 0 }],
          }}
        />
      ) : (
        <WorkspaceSetupNotice options={options} />
      )}
    </div>
  );
}
