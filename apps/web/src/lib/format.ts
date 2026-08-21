/**
 * Display formatting for money and invoice dates.
 *
 * Deliberately free of `server-only`: the invoice form runs a live total in
 * the browser and needs the same formatter the preview and the dashboard use.
 * These lived in `invoice-workspace.ts`, which imports Prisma, so a client
 * component reaching for one dragged the database client into the bundle and
 * failed the build.
 */

/**
 * `currencyDisplay: "code"` on purpose: an invoice reading "MXN 1,000.00"
 * cannot be mistaken for USD the way a bare "$1,000.00" can, and both
 * currencies are in play here.
 */
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "MXN",
  currencyDisplay: "code",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Totals shown in the workspace's own currency (MXN). */
export function formatMoney(value: number) {
  return currencyFormatter.format(value);
}

export function formatInvoiceDate(value: Date) {
  return dateFormatter.format(value);
}

/**
 * An amount in the currency the invoice was issued in.
 *
 * Falls back to the default formatter for a currency code `Intl` does not
 * know: an invoice that stored an unusual code must still render rather than
 * throw a RangeError in the middle of a page.
 */
export function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "code",
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
