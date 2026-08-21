import { describe, expect, it } from "vitest";

import {
  type InvoiceSnapshot,
  summarizeInvoiceChanges,
} from "@/lib/invoice-revision";

const base: InvoiceSnapshot = {
  invoiceNumber: 42,
  invoiceDate: "2026-03-31",
  currency: "MXN",
  status: "DRAFT",
  notes: null,
  userProfileId: 1,
  bankAccountId: 1,
  clientCompanyId: 1,
  lineItems: [
    {
      description: "Monthly services",
      note: null,
      quantity: 1,
      rate: 1000,
      amount: 1000,
    },
  ],
};

describe("summarizeInvoiceChanges", () => {
  it("says so when nothing moved", () => {
    expect(summarizeInvoiceChanges(base, { ...base })).toBe("No changes.");
  });

  it("names a single changed field", () => {
    expect(summarizeInvoiceChanges(base, { ...base, status: "SENT" })).toBe(
      "Updated status.",
    );
  });

  it("joins several changed fields", () => {
    const after = { ...base, status: "SENT", currency: "USD" };
    expect(summarizeInvoiceChanges(base, after)).toBe(
      "Updated currency and status.",
    );
  });

  it("reports a line item count change", () => {
    const after = {
      ...base,
      lineItems: [
        ...base.lineItems,
        {
          description: "Hardware",
          note: null,
          quantity: 1,
          rate: 540,
          amount: 540,
        },
      ],
    };

    expect(summarizeInvoiceChanges(base, after)).toBe(
      "Updated line items (1 → 2).",
    );
  });

  it("reports a total change when the count is unchanged", () => {
    const after = {
      ...base,
      lineItems: [
        {
          description: "Monthly services",
          note: null,
          quantity: 1,
          rate: 1200,
          amount: 1200,
        },
      ],
    };

    expect(summarizeInvoiceChanges(base, after)).toBe(
      "Updated line items (total 1000.00 → 1200.00).",
    );
  });

  it("notices an edit that leaves the total alone", () => {
    // Renaming a line changes the invoice the client reads, even though every
    // number is identical. A total-only comparison would call this no change.
    const after = {
      ...base,
      lineItems: [{ ...base.lineItems[0]!, description: "Consulting" }],
    };

    expect(summarizeInvoiceChanges(base, after)).toContain("line items");
  });

  it("combines field and line item changes", () => {
    const after = {
      ...base,
      status: "SENT",
      lineItems: [],
    };

    expect(summarizeInvoiceChanges(base, after)).toBe(
      "Updated status and line items (1 → 0).",
    );
  });
});
