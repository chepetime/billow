import { describe, expect, it } from "vitest";

import { toInvoiceDetailResponse } from "@/lib/schemas/invoices";
import { invoiceSchema } from "@/lib/schemas/workspace";

const decimal = (value: number) => ({ toNumber: () => value });

const row = {
  publicId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  invoiceNumber: 58,
  invoiceDate: new Date(2026, 2, 31),
  status: "SENT",
  currency: "MXN",
  notes: null,
  sentAt: new Date(2026, 3, 1),
  approvedAt: null,
  paidAt: null,
  cfdiIssuedAt: null,
  createdAt: new Date("2026-03-31T10:00:00.000Z"),
  updatedAt: new Date("2026-04-01T10:00:00.000Z"),
  userProfileId: 3,
  bankAccountId: 3,
  clientCompanyId: 4,
  clientCompany: { id: 4, name: "Acme" },
  total: 1000,
  lineItems: [
    {
      description: "Monthly services",
      note: null,
      quantity: decimal(1),
      rate: decimal(1000),
      amount: decimal(1000),
      position: 0,
    },
  ],
  documents: [],
};

/**
 * The bug this covers, reported from a real install: an invoice could be read
 * but not rewritten. `invoiceSchema` requires userProfileId, bankAccountId and
 * clientCompanyId, and the response carried none of them — so a caller
 * repointing an invoice off a duplicated client had to guess which sender
 * profile and bank account it already used, and with two identical bank
 * accounts there was no way to tell.
 */
describe("an invoice read round-trips into the PUT that rewrites it", () => {
  it("carries every field invoiceSchema requires", () => {
    const response = toInvoiceDetailResponse(row);

    const parsed = invoiceSchema.safeParse({
      userProfileId: response.userProfileId,
      bankAccountId: response.bankAccountId,
      clientCompanyId: response.clientCompanyId,
      invoiceNumber: response.invoiceNumber,
      invoiceDate: response.invoiceDate,
      currency: response.currency,
      status: response.status,
      notes: response.notes,
      lineItems: response.lineItems,
    });

    expect(parsed.success).toBe(true);
  });

  it("reports the three references as ids, not only as a client name", () => {
    const response = toInvoiceDetailResponse(row);
    expect(response.userProfileId).toBe(3);
    expect(response.bankAccountId).toBe(3);
    expect(response.clientCompanyId).toBe(4);
  });

  it("keeps clientCompanyId and client.id consistent", () => {
    // Two ways to read the same reference. Drifting would send a repoint to
    // the wrong row.
    const response = toInvoiceDetailResponse(row);
    expect(response.clientCompanyId).toBe(response.client.id);
  });

  it("still keeps calendar days out of ISO form", () => {
    const response = toInvoiceDetailResponse(row);
    expect(response.invoiceDate).toBe("2026-03-31");
    expect(response.sentAt).toBe("2026-04-01");
    expect(response.createdAt).toBe("2026-03-31T10:00:00.000Z");
  });
});
