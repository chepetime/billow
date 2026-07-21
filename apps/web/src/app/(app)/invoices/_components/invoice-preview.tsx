import { InvoiceStatusBadge } from "@/components/ui/badge";
import {
  formatCurrency,
  formatInvoiceDate,
  getInvoiceById,
} from "@/lib/invoice-workspace";

type Invoice = NonNullable<Awaited<ReturnType<typeof getInvoiceById>>>;

export function InvoicePreview({ invoice }: { invoice: Invoice }) {
  const { userProfile, clientCompany, bankAccount } = invoice;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border bg-card p-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Invoice #{invoice.invoiceNumber}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatInvoiceDate(invoice.invoiceDate)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {invoice.currency}
          </span>
          <InvoiceStatusBadge status={invoice.status} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-medium text-muted-foreground">From</h2>
          <div className="mt-2 space-y-0.5 text-sm">
            <p className="font-medium">{userProfile.displayName}</p>
            <p>{userProfile.legalName}</p>
            <p>{userProfile.email}</p>
            {userProfile.taxId && (
              <p className="text-muted-foreground">
                Tax ID: {userProfile.taxId}
              </p>
            )}
            <p className="whitespace-pre-line text-muted-foreground">
              {userProfile.address}
            </p>
            {userProfile.department && (
              <p className="text-muted-foreground">
                {userProfile.department}
              </p>
            )}
            {userProfile.manager && (
              <p className="text-muted-foreground">
                Manager: {userProfile.manager}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-medium text-muted-foreground">
            Bill To
          </h2>
          <div className="mt-2 space-y-0.5 text-sm">
            <p className="font-medium">{clientCompany.name}</p>
            {clientCompany.legalName && <p>{clientCompany.legalName}</p>}
            {clientCompany.attentionTo && (
              <p className="text-muted-foreground">
                Attn: {clientCompany.attentionTo}
              </p>
            )}
            <p className="text-muted-foreground">{clientCompany.address1}</p>
            {clientCompany.address2 && (
              <p className="text-muted-foreground">
                {clientCompany.address2}
              </p>
            )}
            <p className="text-muted-foreground">
              {clientCompany.cityStatePostal}
            </p>
            <p className="text-muted-foreground">{clientCompany.country}</p>
            <p>{clientCompany.email}</p>
          </div>
        </section>
      </div>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-sm font-medium">Line items</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Description</th>
                <th className="py-2 pr-4 text-right font-medium">Qty</th>
                <th className="py-2 pr-4 text-right font-medium">Rate</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoice.lineItems.map((lineItem) => (
                <tr key={lineItem.id}>
                  <td className="py-2 pr-4">
                    <p>{lineItem.description}</p>
                    {lineItem.note && (
                      <p className="text-xs text-muted-foreground">
                        {lineItem.note}
                      </p>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {Number(lineItem.quantity)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {formatCurrency(Number(lineItem.rate), invoice.currency)}
                  </td>
                  <td className="py-2 text-right">
                    {formatCurrency(Number(lineItem.amount), invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <td className="py-2 pr-4" colSpan={3}>
                  Total
                </td>
                <td className="py-2 text-right">
                  {formatCurrency(invoice.total, invoice.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-sm font-medium">Payment instructions</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Account</p>
            <p className="text-sm font-medium">{bankAccount.label}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Bank</p>
            <p className="text-sm font-medium">{bankAccount.bankName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Account holder</p>
            <p className="text-sm font-medium">
              {bankAccount.accountHolderName}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Account number</p>
            <p className="text-sm font-medium">{bankAccount.accountNumber}</p>
          </div>
          {bankAccount.accountType && (
            <div>
              <p className="text-xs text-muted-foreground">Account type</p>
              <p className="text-sm font-medium">{bankAccount.accountType}</p>
            </div>
          )}
          {bankAccount.routingNumber && (
            <div>
              <p className="text-xs text-muted-foreground">Routing number</p>
              <p className="text-sm font-medium">
                {bankAccount.routingNumber}
              </p>
            </div>
          )}
          {bankAccount.institutionNumber && (
            <div>
              <p className="text-xs text-muted-foreground">
                Institution number
              </p>
              <p className="text-sm font-medium">
                {bankAccount.institutionNumber}
              </p>
            </div>
          )}
          {bankAccount.transitNumber && (
            <div>
              <p className="text-xs text-muted-foreground">Transit number</p>
              <p className="text-sm font-medium">
                {bankAccount.transitNumber}
              </p>
            </div>
          )}
          {bankAccount.swift && (
            <div>
              <p className="text-xs text-muted-foreground">SWIFT</p>
              <p className="text-sm font-medium">{bankAccount.swift}</p>
            </div>
          )}
          {bankAccount.iban && (
            <div>
              <p className="text-xs text-muted-foreground">IBAN</p>
              <p className="text-sm font-medium">{bankAccount.iban}</p>
            </div>
          )}
          {bankAccount.clabe && (
            <div>
              <p className="text-xs text-muted-foreground">CLABE</p>
              <p className="text-sm font-medium">{bankAccount.clabe}</p>
            </div>
          )}
          {bankAccount.accountHolderAddress && (
            <div>
              <p className="text-xs text-muted-foreground">
                Account holder address
              </p>
              <p className="text-sm font-medium">
                {bankAccount.accountHolderAddress}
              </p>
            </div>
          )}
          {bankAccount.bankAddress && (
            <div>
              <p className="text-xs text-muted-foreground">Bank address</p>
              <p className="text-sm font-medium">{bankAccount.bankAddress}</p>
            </div>
          )}
          {bankAccount.bankPhone && (
            <div>
              <p className="text-xs text-muted-foreground">Bank phone</p>
              <p className="text-sm font-medium">{bankAccount.bankPhone}</p>
            </div>
          )}
        </div>
      </section>

      {invoice.notes && (
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-medium">Notes</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
            {invoice.notes}
          </p>
        </section>
      )}
    </div>
  );
}
