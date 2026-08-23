import { describe, expect, it } from "vitest";

import { invoiceWorkflowCommandSchema } from "@/lib/schemas/invoice-workflow";

const invoiceId = "c4d76986-85ff-46eb-8e5e-83ab08c698a6";

describe("invoiceWorkflowCommandSchema", () => {
  it("accepts clearing an independently editable milestone", () => {
    expect(
      invoiceWorkflowCommandSchema.safeParse({
        type: "milestone",
        invoiceId,
        milestone: "approvedAt",
        date: null,
      }).success,
    ).toBe(true);
    expect(
      invoiceWorkflowCommandSchema.safeParse({
        type: "clear-cfdi",
        invoiceId,
      }).success,
    ).toBe(true);
  });

  it("normalizes a valid tax amount from a form value", () => {
    const parsed = invoiceWorkflowCommandSchema.safeParse({
      type: "tax-payment",
      invoiceId,
      paidOn: "2026-08-12",
      amountPaid: "1234.56",
      currency: "MXN",
      confirmationUploadId: "upload-1",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "tax-payment") {
      expect(parsed.data.amountPaid).toBe(1234.56);
    }
  });

  it("rejects impossible dates and money with fractions of a cent", () => {
    expect(
      invoiceWorkflowCommandSchema.safeParse({
        type: "milestone",
        invoiceId,
        milestone: "sentAt",
        date: "2026-02-31",
      }).success,
    ).toBe(false);
    expect(
      invoiceWorkflowCommandSchema.safeParse({
        type: "tax-payment",
        invoiceId,
        paidOn: "2026-08-12",
        amountPaid: "12.345",
        currency: "MXN",
      }).success,
    ).toBe(false);
  });
});
