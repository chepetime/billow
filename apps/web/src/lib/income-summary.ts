/**
 * The fiscal year summary, as a pure fold over rows already read.
 *
 * Pure and free of `server-only` on purpose: this is the part with the real
 * logic — currency grouping, month bucketing, what counts as paid — and it is
 * worth testing without a database. `lib/workspace/income.ts` does the reading.
 *
 * **Everything is grouped by currency, never summed across it.** A USD invoice
 * is not worth its face value in pesos, and no exchange rate is stored. A month
 * reports one row per currency it actually billed in, and a consumer that
 * wants a single number has to supply and disclose the rate it used.
 */

export type CurrencyAmount = {
  currency: string;
  amount: number;
  invoiceCount: number;
};

export type IncomeMonth = {
  year: number;
  month: number;
  invoiced: CurrencyAmount[];
  paid: CurrencyAmount[];
  cfdi: { issued: number; missing: number };
  taxPeriod: {
    filedAt: string | null;
    paidAt: string | null;
    amountPaid: number | null;
    currency: string;
    hasReturn: boolean;
    hasPaymentConfirmation: boolean;
  } | null;
};

export type IncomeSummary = {
  year: number;
  currencies: string[];
  months: IncomeMonth[];
  totals: { invoiced: CurrencyAmount[]; paid: CurrencyAmount[] };
};

export type IncomeInvoice = {
  /** Local calendar month, 1-12, taken from the invoice date. */
  month: number;
  currency: string;
  total: number;
  paid: boolean;
  cfdiIssued: boolean;
};

export type IncomeTaxPeriod = {
  month: number;
  filedAt: string | null;
  paidAt: string | null;
  amountPaid: number | null;
  currency: string;
  hasReturn: boolean;
  hasPaymentConfirmation: boolean;
};

/** Accumulates per currency, dropping currencies with nothing in them. */
function tally(invoices: IncomeInvoice[]): CurrencyAmount[] {
  const byCurrency = new Map<string, CurrencyAmount>();
  for (const invoice of invoices) {
    const existing = byCurrency.get(invoice.currency);
    if (existing) {
      existing.amount += invoice.total;
      existing.invoiceCount += 1;
    } else {
      byCurrency.set(invoice.currency, {
        currency: invoice.currency,
        amount: invoice.total,
        invoiceCount: 1,
      });
    }
  }

  return [...byCurrency.values()]
    .map((entry) => ({
      ...entry,
      // Money summed as floats drifts in the last cent. The column is
      // Decimal(12,2), so rounding back to it is a restatement, not a change.
      amount: Math.round(entry.amount * 100) / 100,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export function summarizeIncome(
  year: number,
  invoices: IncomeInvoice[],
  taxPeriods: IncomeTaxPeriod[],
): IncomeSummary {
  const periodByMonth = new Map(
    taxPeriods.map((period) => [period.month, period]),
  );

  // Every month of the year is present, including the empty ones. A consumer
  // charting a year should not have to reconstruct which months are missing,
  // and "no invoices in April" is itself the answer to a tax question.
  const months: IncomeMonth[] = Array.from({ length: 12 }, (_unused, index) => {
    const month = index + 1;
    const inMonth = invoices.filter((invoice) => invoice.month === month);
    const period = periodByMonth.get(month);

    return {
      year,
      month,
      invoiced: tally(inMonth),
      paid: tally(inMonth.filter((invoice) => invoice.paid)),
      cfdi: {
        issued: inMonth.filter((invoice) => invoice.cfdiIssued).length,
        missing: inMonth.filter((invoice) => !invoice.cfdiIssued).length,
      },
      taxPeriod: period
        ? {
            filedAt: period.filedAt,
            paidAt: period.paidAt,
            amountPaid: period.amountPaid,
            currency: period.currency,
            hasReturn: period.hasReturn,
            hasPaymentConfirmation: period.hasPaymentConfirmation,
          }
        : null,
    };
  });

  return {
    year,
    currencies: [
      ...new Set(invoices.map((invoice) => invoice.currency)),
    ].sort(),
    months,
    totals: {
      invoiced: tally(invoices),
      paid: tally(invoices.filter((invoice) => invoice.paid)),
    },
  };
}
