import { describe, expect, it } from "vitest";

import { toTaxPeriodResponse } from "@/lib/schemas/tax-periods";
import { taxPeriodSchema } from "@/lib/schemas/workspace";

function decimal(value: number) {
  return { toNumber: () => value };
}

const row = {
  id: 3,
  year: 2026,
  month: 3,
  currency: "MXN",
  amountPaid: decimal(1234.56),
  // Local midnight, which is how parseDateOnly stores a calendar day.
  filedAt: new Date(2026, 2, 1),
  paidAt: null,
  notes: null,
  createdAt: new Date("2026-03-02T10:00:00.000Z"),
  updatedAt: new Date("2026-03-02T10:00:00.000Z"),
  documents: [
    {
      id: 9,
      kind: "TAX_RETURN",
      uploadId: "up_1",
      note: null,
      createdAt: new Date("2026-03-02T10:00:00.000Z"),
    },
  ],
};

describe("toTaxPeriodResponse", () => {
  it("emits calendar days as YYYY-MM-DD, not as instants", () => {
    // The bug this guards: serialising a March 1 filing as an ISO instant
    // hands a caller "2026-03-01T06:00:00.000Z" in Mexico City, which renders
    // as February 28 and falls out of its own month. See lib/date-only.ts.
    const response = toTaxPeriodResponse(row);
    expect(response.filedAt).toBe("2026-03-01");
    expect(response.paidAt).toBeNull();
  });

  it("keeps real instants as ISO timestamps", () => {
    const response = toTaxPeriodResponse(row);
    expect(response.createdAt).toBe("2026-03-02T10:00:00.000Z");
    expect(response.documents[0]?.createdAt).toBe("2026-03-02T10:00:00.000Z");
  });

  it("converts Decimal to a number", () => {
    // JSON.stringify renders a Prisma Decimal as an object, so a caller would
    // receive {} where it expected an amount.
    const response = toTaxPeriodResponse(row);
    expect(response.amountPaid).toBe(1234.56);
    expect(JSON.parse(JSON.stringify(response)).amountPaid).toBe(1234.56);
  });

  it("reports an unpaid month as null rather than zero", () => {
    const response = toTaxPeriodResponse({ ...row, amountPaid: null });
    expect(response.amountPaid).toBeNull();
  });
});

describe("taxPeriodSchema", () => {
  it("treats an absent nullable field as null, which makes PUT a replacement", () => {
    const parsed = taxPeriodSchema.parse({ year: 2026, month: 3 });
    expect(parsed).toMatchObject({
      currency: "MXN",
      amountPaid: null,
      filedAt: null,
      paidAt: null,
      notes: null,
    });
  });

  it.each([
    ["a month above 12", { year: 2026, month: 13 }],
    ["a month below 1", { year: 2026, month: 0 }],
    ["a year before 2000", { year: 1999, month: 1 }],
    ["a non-integer month", { year: 2026, month: 3.5 }],
  ])("rejects %s", (_label, input) => {
    expect(taxPeriodSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a date that is not a real calendar day", () => {
    expect(
      taxPeriodSchema.safeParse({ year: 2026, month: 2, filedAt: "2026-02-31" })
        .success,
    ).toBe(false);
  });

  it("rejects an amount with more precision than the column stores", () => {
    // Decimal(12, 2) rounds on write; silently turning 10.005 into 10.01 on a
    // tax record is the kind of thing noticed a quarter later.
    expect(
      taxPeriodSchema.safeParse({ year: 2026, month: 3, amountPaid: 10.005 })
        .success,
    ).toBe(false);
  });
});
