import { InvoiceStatusBadge } from "@/components/ui/badge";
import { formatCurrency, formatInvoiceDate } from "@/lib/format";
import type { getInvoiceById } from "@/lib/invoice-workspace";

type Invoice = NonNullable<Awaited<ReturnType<typeof getInvoiceById>>>;

/** A payment-detail row rendered only when the bank account has a value for it. */
function PaymentRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;

  return (
    <div className="grid grid-cols-3 gap-4 px-4 py-1.5 text-sm leading-tight print:gap-2 print:px-3 print:py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 font-medium">{value}</dd>
    </div>
  );
}

export function InvoicePreview({ invoice }: { invoice: Invoice }) {
  const { userProfile, clientCompany, bankAccount } = invoice;

  return (
    <div className="mx-auto w-full max-w-3xl rounded-xl border bg-card p-6 shadow-sm sm:p-10 print:m-0 print:max-w-none print:rounded-none print:border-none print:p-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 leading-tight print:justify-end">
        <div className="flex items-center gap-2 print:hidden">
          <InvoiceStatusBadge status={invoice.status} sentAt={invoice.sentAt} />
          <span className="text-sm text-muted-foreground">
            {invoice.currency}
          </span>
        </div>
        <div className="text-right">
          <h1 className="text-xl font-bold leading-none tracking-tight">
            #{invoice.invoiceNumber}
          </h1>
          <p className="mt-0.5 text-sm leading-none text-muted-foreground">
            {formatInvoiceDate(invoice.invoiceDate)}
          </p>
        </div>
      </div>

      <div className="mt-16 grid gap-8 leading-tight sm:grid-cols-2 print:mt-10 print:gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            From
          </p>
          <div className="mt-2 text-sm leading-tight">
            <p className="font-semibold">{userProfile.displayName}</p>
            {userProfile.legalName !== userProfile.displayName && (
              <p>{userProfile.legalName}</p>
            )}
            <p className="whitespace-pre-line text-muted-foreground">
              {userProfile.address}
            </p>
            <p className="text-muted-foreground">{userProfile.email}</p>
            {userProfile.taxId && (
              <p className="text-muted-foreground">{userProfile.taxId}</p>
            )}
            {userProfile.department && (
              <p className="text-muted-foreground">{userProfile.department}</p>
            )}
            {userProfile.manager && (
              <p className="text-muted-foreground">
                Manager: {userProfile.manager}
              </p>
            )}
          </div>
        </div>

        <div className="sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Bill to
          </p>
          <div className="mt-2 text-sm leading-tight">
            <p className="font-semibold">{clientCompany.name}</p>
            {clientCompany.legalName && <p>{clientCompany.legalName}</p>}
            {clientCompany.attentionTo && (
              <p className="text-muted-foreground">
                Attn: {clientCompany.attentionTo}
              </p>
            )}
            <p className="text-muted-foreground">{clientCompany.address1}</p>
            {clientCompany.address2 && (
              <p className="text-muted-foreground">{clientCompany.address2}</p>
            )}
            <p className="text-muted-foreground">
              {clientCompany.cityStatePostal}
            </p>
            <p className="text-muted-foreground">{clientCompany.country}</p>
            <p className="text-muted-foreground">{clientCompany.email}</p>
          </div>
        </div>
      </div>

      <div className="mt-16 overflow-hidden rounded-lg border print:mt-10">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-4 py-2 font-semibold print:py-1.5">
                  Description
                </th>
                <th className="px-4 py-2 text-right font-semibold print:py-1.5">
                  Qty
                </th>
                <th className="px-4 py-2 text-right font-semibold print:py-1.5">
                  Rate ({invoice.currency})
                </th>
                <th className="px-4 py-2 text-right font-semibold print:py-1.5">
                  Total ({invoice.currency})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoice.lineItems.map((lineItem) => (
                <tr key={lineItem.id}>
                  <td className="px-4 py-1.5 leading-tight print:py-1">
                    <p>{lineItem.description}</p>
                    {lineItem.note && (
                      <p className="text-xs text-muted-foreground">
                        {lineItem.note}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-1.5 text-right leading-tight print:py-1">
                    {Number(lineItem.quantity)}
                  </td>
                  <td className="px-4 py-1.5 text-right leading-tight print:py-1">
                    {formatCurrency(Number(lineItem.rate), invoice.currency)}
                  </td>
                  <td className="px-4 py-1.5 text-right font-semibold leading-tight print:py-1">
                    {formatCurrency(Number(lineItem.amount), invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2 text-sm font-semibold print:py-1.5">
          <span>Total</span>
          <span>{formatCurrency(invoice.total, invoice.currency)}</span>
        </div>
      </div>

      <div className="mt-16 overflow-hidden rounded-lg border print:mt-10">
        <div className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold print:px-3 print:py-1.5">
          Bank information
        </div>
        <dl className="divide-y divide-border">
          <PaymentRow label="Account" value={bankAccount.label} />
          <PaymentRow label="Bank" value={bankAccount.bankName} />
          <PaymentRow label="Bank address" value={bankAccount.bankAddress} />
          <PaymentRow label="Bank phone" value={bankAccount.bankPhone} />
          <PaymentRow
            label="Account holder"
            value={bankAccount.accountHolderName}
          />
          <PaymentRow
            label="Account holder address"
            value={bankAccount.accountHolderAddress}
          />
          <PaymentRow
            label="Account number"
            value={bankAccount.accountNumber}
          />
          <PaymentRow label="Account type" value={bankAccount.accountType} />
          <PaymentRow
            label="Routing number"
            value={bankAccount.routingNumber}
          />
          <PaymentRow
            label="Institution number"
            value={bankAccount.institutionNumber}
          />
          <PaymentRow
            label="Transit number"
            value={bankAccount.transitNumber}
          />
          <PaymentRow label="SWIFT" value={bankAccount.swift} />
          <PaymentRow label="IBAN" value={bankAccount.iban} />
          <PaymentRow label="CLABE" value={bankAccount.clabe} />
        </dl>
      </div>

      {invoice.notes && (
        <div className="mt-14 print:mt-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Notes
          </p>
          <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
            {invoice.notes}
          </p>
        </div>
      )}

      <p className="mt-16 text-center text-sm text-muted-foreground print:mt-10">
        Please send remittance advice to{" "}
        <span className="font-medium text-foreground">{userProfile.email}</span>
      </p>
    </div>
  );
}
