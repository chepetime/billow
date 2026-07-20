import { describe, expect, it } from "vitest";

import { InvoiceStatus } from "@/generated/prisma/enums";
import { parseInvoiceStatus } from "@/lib/invoice-status";

describe("parseInvoiceStatus", () => {
  it("defaults to draft when no status is provided", () => {
    expect(parseInvoiceStatus("")).toBe(InvoiceStatus.DRAFT);
    expect(parseInvoiceStatus(null)).toBe(InvoiceStatus.DRAFT);
  });

  it("accepts known invoice statuses", () => {
    expect(parseInvoiceStatus("SENT")).toBe(InvoiceStatus.SENT);
    expect(parseInvoiceStatus(" PAID ")).toBe(InvoiceStatus.PAID);
  });

  it("rejects unsupported statuses", () => {
    expect(() => parseInvoiceStatus("ARCHIVED")).toThrow(
      "Unsupported invoice status: ARCHIVED",
    );
  });
});
