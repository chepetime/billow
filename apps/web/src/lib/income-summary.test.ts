import { describe, expect, it } from "vitest";

import {
  type IncomeInvoice,
  type IncomeTaxPeriod,
  summarizeIncome,
} from "@/lib/income-summary";

const mxn = (
  month: number,
  total: number,
  extra: Partial<IncomeInvoice> = {},
): IncomeInvoice => ({
  month,
  currency: "MXN",
  total,
  paid: false,
  cfdiIssued: false,
  ...extra,
});

function monthOf(summary: ReturnType<typeof summarizeIncome>, month: number) {
  const found = summary.months.find((entry) => entry.month === month);
  if (!found) throw new Error(`month ${month} missing`);
  return found;
}

describe("currency grouping", () => {
  /**
   * The property this file exists for. The dashboard adds every invoice into
   * one figure and labels it MXN; a tax summary cannot, because a USD invoice
   * is not worth its face value in pesos and no rate is stored anywhere.
   */
  it("never sums across currencies", () => {
    const summary = summarizeIncome(
      2026,
      [
        mxn(3, 1000),
        {
          month: 3,
          currency: "USD",
          total: 500,
          paid: false,
          cfdiIssued: false,
        },
      ],
      [],
    );

    expect(monthOf(summary, 3).invoiced).toEqual([
      { currency: "MXN", amount: 1000, invoiceCount: 1 },
      { currency: "USD", amount: 500, invoiceCount: 1 },
    ]);
    expect(summary.currencies).toEqual(["MXN", "USD"]);
  });

  it("reports no total field a consumer could mistake for a grand total", () => {
    const summary = summarizeIncome(2026, [mxn(1, 10)], []);
    expect(summary.totals.invoiced).toBeInstanceOf(Array);
    expect(summary).not.toHaveProperty("total");
    expect(monthOf(summary, 1)).not.toHaveProperty("total");
  });

  it("orders currencies deterministically", () => {
    const summary = summarizeIncome(
      2026,
      [
        { month: 1, currency: "USD", total: 1, paid: false, cfdiIssued: false },
        { month: 1, currency: "EUR", total: 1, paid: false, cfdiIssued: false },
        mxn(1, 1),
      ],
      [],
    );
    expect(monthOf(summary, 1).invoiced.map((e) => e.currency)).toEqual([
      "EUR",
      "MXN",
      "USD",
    ]);
  });
});

describe("months", () => {
  it("returns all twelve, including empty ones", () => {
    // "Nothing was invoiced in April" is itself the answer to a tax question,
    // and a consumer charting a year should not reconstruct the gaps.
    const summary = summarizeIncome(2026, [mxn(3, 100)], []);
    expect(summary.months).toHaveLength(12);
    expect(monthOf(summary, 4).invoiced).toEqual([]);
    expect(monthOf(summary, 4).taxPeriod).toBeNull();
  });

  it("buckets invoices into their own month only", () => {
    const summary = summarizeIncome(2026, [mxn(3, 100), mxn(4, 200)], []);
    expect(monthOf(summary, 3).invoiced[0]?.amount).toBe(100);
    expect(monthOf(summary, 4).invoiced[0]?.amount).toBe(200);
  });
});

describe("paid", () => {
  it("counts only paid invoices, and separately from invoiced", () => {
    const summary = summarizeIncome(
      2026,
      [mxn(5, 1000, { paid: true }), mxn(5, 400)],
      [],
    );

    expect(monthOf(summary, 5).invoiced).toEqual([
      { currency: "MXN", amount: 1400, invoiceCount: 2 },
    ]);
    expect(monthOf(summary, 5).paid).toEqual([
      { currency: "MXN", amount: 1000, invoiceCount: 1 },
    ]);
  });

  it("omits a currency entirely when nothing in it was paid", () => {
    const summary = summarizeIncome(
      2026,
      [{ month: 5, currency: "USD", total: 9, paid: false, cfdiIssued: false }],
      [],
    );
    expect(monthOf(summary, 5).paid).toEqual([]);
  });
});

describe("cfdi", () => {
  it("splits issued from missing", () => {
    const summary = summarizeIncome(
      2026,
      [mxn(6, 1, { cfdiIssued: true }), mxn(6, 1), mxn(6, 1)],
      [],
    );
    expect(monthOf(summary, 6).cfdi).toEqual({ issued: 1, missing: 2 });
  });
});

describe("tax periods", () => {
  const period: IncomeTaxPeriod = {
    month: 7,
    filedAt: "2026-08-17",
    paidAt: null,
    amountPaid: null,
    currency: "MXN",
    hasReturn: true,
    hasPaymentConfirmation: false,
  };

  it("attaches the filing state to its month", () => {
    const summary = summarizeIncome(2026, [], [period]);
    expect(monthOf(summary, 7).taxPeriod).toMatchObject({
      filedAt: "2026-08-17",
      hasReturn: true,
      hasPaymentConfirmation: false,
    });
    expect(monthOf(summary, 8).taxPeriod).toBeNull();
  });

  it("keeps calendar days as YYYY-MM-DD", () => {
    const summary = summarizeIncome(2026, [], [period]);
    expect(monthOf(summary, 7).taxPeriod?.filedAt).toBe("2026-08-17");
  });
});

describe("rounding", () => {
  it("restates a float-drifting sum at the precision the column stores", () => {
    // 0.1 + 0.2 is 0.30000000000000004. Decimal(12,2) cannot hold that, so
    // reporting it would be inventing precision the database does not have.
    const summary = summarizeIncome(2026, [mxn(1, 0.1), mxn(1, 0.2)], []);
    expect(monthOf(summary, 1).invoiced[0]?.amount).toBe(0.3);
  });
});
