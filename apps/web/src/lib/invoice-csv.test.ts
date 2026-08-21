import { describe, expect, it } from "vitest";

import { type InvoiceCsvRow, invoicesToCsv } from "@/lib/invoice-csv";

function row(overrides: Partial<InvoiceCsvRow> = {}): InvoiceCsvRow {
  return {
    invoiceNumber: 1,
    invoiceDate: new Date(Date.UTC(2026, 8, 30)),
    clientName: "Acme Co",
    currency: "MXN",
    status: "DRAFT",
    total: 100,
    ...overrides,
  };
}

describe("invoicesToCsv", () => {
  it("emits just the header for an empty list", () => {
    expect(invoicesToCsv([])).toBe(
      "Invoice Number,Date,Client,Currency,Status,Total\r\n",
    );
  });

  it("formats a row for parsing rather than display", () => {
    const csv = invoicesToCsv([row()]);

    expect(csv).toBe(
      "Invoice Number,Date,Client,Currency,Status,Total\r\n" +
        "1,2026-09-30,Acme Co,MXN,Draft,100.00\r\n",
    );
  });

  it("quotes a client name containing a comma and doubles an embedded quote", () => {
    const csv = invoicesToCsv([
      row({ clientName: 'Change.org, PBC "Change"' }),
    ]);

    expect(csv).toContain('"Change.org, PBC ""Change"""');
  });

  it("keeps decimal precision on the total", () => {
    const csv = invoicesToCsv([row({ total: 99.999 })]);

    expect(csv).toContain(",100.00\r\n");
  });

  it("title-cases every status", () => {
    const csv = invoicesToCsv([
      row({ invoiceNumber: 1, status: "SENT" }),
      row({ invoiceNumber: 2, status: "PAID" }),
      row({ invoiceNumber: 3, status: "VOID" }),
    ]);

    expect(csv).toContain(",Sent,");
    expect(csv).toContain(",Paid,");
    expect(csv).toContain(",Void,");
  });
});
