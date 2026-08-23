import { InvoiceStatus } from "@billow/db/enums";
import { describe, expect, it } from "vitest";
import {
  deriveInvoiceStatus,
  invoiceAttentionLabel,
  invoiceStatusLabel,
  nextInvoiceStatus,
  parseInvoiceStatus,
  previousInvoiceStatus,
} from "@/lib/invoice-status";

describe("parseInvoiceStatus", () => {
  it("defaults to draft when no status is provided", () => {
    expect(parseInvoiceStatus("")).toBe(InvoiceStatus.DRAFT);
    expect(parseInvoiceStatus(null)).toBe(InvoiceStatus.DRAFT);
  });

  it("accepts known invoice statuses", () => {
    expect(parseInvoiceStatus("SENT")).toBe(InvoiceStatus.SENT);
    expect(parseInvoiceStatus(" PAID ")).toBe(InvoiceStatus.PAID);
    expect(parseInvoiceStatus("TAX_RECEIPT")).toBe(InvoiceStatus.TAX_RECEIPT);
    expect(parseInvoiceStatus("TAX_RETURN")).toBe(InvoiceStatus.TAX_RETURN);
    expect(parseInvoiceStatus("DONE")).toBe(InvoiceStatus.DONE);
  });

  it("rejects unsupported statuses", () => {
    expect(() => parseInvoiceStatus("ARCHIVED")).toThrow(
      "Unsupported invoice status: ARCHIVED",
    );
  });
});

describe("nextInvoiceStatus", () => {
  it("walks the forward lifecycle one state at a time", () => {
    expect(nextInvoiceStatus(InvoiceStatus.DRAFT)).toBe(InvoiceStatus.SENT);
    expect(nextInvoiceStatus(InvoiceStatus.SENT)).toBe(InvoiceStatus.APPROVED);
    expect(nextInvoiceStatus(InvoiceStatus.APPROVED)).toBe(InvoiceStatus.PAID);
    expect(nextInvoiceStatus(InvoiceStatus.PAID)).toBe(
      InvoiceStatus.TAX_RECEIPT,
    );
    expect(nextInvoiceStatus(InvoiceStatus.TAX_RECEIPT)).toBe(
      InvoiceStatus.DONE,
    );
  });

  it("has no forward transition from a terminal state", () => {
    expect(nextInvoiceStatus(InvoiceStatus.DONE)).toBeNull();
    expect(nextInvoiceStatus(InvoiceStatus.TAX_RETURN)).toBeNull();
    expect(nextInvoiceStatus(InvoiceStatus.VOID)).toBeNull();
  });
});

describe("previousInvoiceStatus", () => {
  it("walks the lifecycle backward one state at a time", () => {
    expect(previousInvoiceStatus(InvoiceStatus.SENT)).toBe(InvoiceStatus.DRAFT);
    expect(previousInvoiceStatus(InvoiceStatus.APPROVED)).toBe(
      InvoiceStatus.SENT,
    );
    expect(previousInvoiceStatus(InvoiceStatus.PAID)).toBe(
      InvoiceStatus.APPROVED,
    );
    expect(previousInvoiceStatus(InvoiceStatus.TAX_RECEIPT)).toBe(
      InvoiceStatus.PAID,
    );
    expect(previousInvoiceStatus(InvoiceStatus.DONE)).toBe(
      InvoiceStatus.TAX_RECEIPT,
    );
  });

  it("has no backward transition from draft or void", () => {
    expect(previousInvoiceStatus(InvoiceStatus.DRAFT)).toBeNull();
    expect(previousInvoiceStatus(InvoiceStatus.TAX_RETURN)).toBeNull();
    expect(previousInvoiceStatus(InvoiceStatus.VOID)).toBeNull();
  });
});

describe("deriveInvoiceStatus", () => {
  const empty = {
    currentStatus: InvoiceStatus.DRAFT,
    sentAt: null,
    approvedAt: null,
    paidAt: null,
    cfdiIssuedAt: null,
    hasCfdiXml: false,
    hasCfdiPdf: false,
  };

  it("derives progress from the furthest recorded fact", () => {
    expect(deriveInvoiceStatus({ ...empty, sentAt: "2026-08-01" })).toBe(
      InvoiceStatus.SENT,
    );
    expect(deriveInvoiceStatus({ ...empty, approvedAt: "2026-08-02" })).toBe(
      InvoiceStatus.APPROVED,
    );
    expect(deriveInvoiceStatus({ ...empty, paidAt: "2026-08-03" })).toBe(
      InvoiceStatus.PAID,
    );
  });

  it("only completes the CFDI step when its date, XML, and PDF exist", () => {
    expect(
      deriveInvoiceStatus({
        ...empty,
        cfdiIssuedAt: "2026-08-04",
        hasCfdiXml: true,
      }),
    ).toBe(InvoiceStatus.TAX_RECEIPT);
    expect(
      deriveInvoiceStatus({
        ...empty,
        cfdiIssuedAt: "2026-08-04",
        hasCfdiXml: true,
        hasCfdiPdf: true,
      }),
    ).toBe(InvoiceStatus.DONE);
  });

  it("preserves void as an explicit exception", () => {
    expect(
      deriveInvoiceStatus({
        ...empty,
        currentStatus: InvoiceStatus.VOID,
        paidAt: "2026-08-03",
      }),
    ).toBe(InvoiceStatus.VOID);
  });
});

describe("invoiceAttentionLabel", () => {
  it("reports the next missing fact instead of trusting a stale status", () => {
    expect(
      invoiceAttentionLabel({
        currentStatus: InvoiceStatus.PAID,
        sentAt: "2026-08-01",
        approvedAt: null,
        paidAt: "2026-08-03",
        cfdiIssuedAt: null,
        hasCfdiXml: false,
        hasCfdiPdf: false,
      }),
    ).toBe("Record client approval");
  });
});

describe("invoiceStatusLabel", () => {
  it("turns enum values into readable labels", () => {
    expect(invoiceStatusLabel(InvoiceStatus.TAX_RECEIPT)).toBe("Tax receipt");
    expect(invoiceStatusLabel(InvoiceStatus.TAX_RETURN)).toBe("Tax return");
  });
});
