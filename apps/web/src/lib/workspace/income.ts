import "server-only";

import { toDateInputValue } from "@/lib/date-only";
import { type IncomeSummary, summarizeIncome } from "@/lib/income-summary";
import { PAID_INVOICE_STATUSES } from "@/lib/invoice-status";
import {
  refuse,
  rule,
  succeed,
  type WorkspaceResult,
} from "@/lib/workspace/rule";

/**
 * Reads the rows a fiscal year summary is folded from.
 *
 * The fold itself is `lib/income-summary.ts`, which is pure. Everything here
 * is a query.
 *
 * Sums are grouped in JavaScript rather than SQL because the grouping keys
 * live in two tables — `Invoice.currency` and the calendar month of
 * `Invoice.invoiceDate`, against `InvoiceLineItem.amount` — which Prisma's
 * `groupBy` cannot span. Raw SQL could, at the cost of re-deriving the local
 * month boundary in Postgres, which is exactly the conversion `date-only.ts`
 * exists to keep in one place. A year of a contractor's invoices is a few
 * dozen rows, so the fold is cheap and the month arithmetic stays in the
 * language that already gets it right.
 */

const PAID = new Set<string>(PAID_INVOICE_STATUSES);

/** The half-open instant range covering a calendar year, in local time. */
export function yearRange(year: number) {
  return { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };
}

export async function getIncomeSummary(
  userId: string,
  year: number,
): Promise<WorkspaceResult<IncomeSummary>> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return refuse("invalid", { year: ["Enter a year between 2000 and 2100."] });
  }

  return rule("getIncomeSummary", async ({ prisma }) => {
    const range = yearRange(year);

    const [invoices, lineTotals, taxPeriods] = await Promise.all([
      prisma.invoice.findMany({
        where: { userId, invoiceDate: range, status: { not: "VOID" } },
        select: {
          id: true,
          currency: true,
          invoiceDate: true,
          status: true,
          cfdiIssuedAt: true,
        },
      }),
      // One grouped aggregate over the year's line items, rather than
      // hydrating each invoice's items to add them up.
      prisma.invoiceLineItem.groupBy({
        by: ["invoiceId"],
        _sum: { amount: true },
        where: {
          invoice: { userId, invoiceDate: range, status: { not: "VOID" } },
        },
      }),
      prisma.taxPeriod.findMany({
        where: { userId, year },
        include: { documents: { select: { kind: true } } },
      }),
    ]);

    const totalById = new Map(
      lineTotals.map((row) => [row.invoiceId, Number(row._sum.amount ?? 0)]),
    );

    return succeed(
      summarizeIncome(
        year,
        invoices.map((invoice) => ({
          // Local month, matching how a date-only value was stored. Reading
          // it in UTC would move a March 1 invoice into February.
          month: invoice.invoiceDate.getMonth() + 1,
          currency: invoice.currency,
          total: totalById.get(invoice.id) ?? 0,
          paid: PAID.has(invoice.status),
          cfdiIssued: invoice.cfdiIssuedAt !== null,
        })),
        taxPeriods.map((period) => ({
          month: period.month,
          filedAt: period.filedAt ? toDateInputValue(period.filedAt) : null,
          paidAt: period.paidAt ? toDateInputValue(period.paidAt) : null,
          amountPaid:
            period.amountPaid === null ? null : period.amountPaid.toNumber(),
          currency: period.currency,
          hasReturn: period.documents.some(
            (document) => document.kind === "TAX_RETURN",
          ),
          hasPaymentConfirmation: period.documents.some(
            (document) => document.kind === "PAYMENT_CONFIRMATION",
          ),
        })),
      ),
    );
  });
}
