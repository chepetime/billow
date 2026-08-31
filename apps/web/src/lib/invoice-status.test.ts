import { InvoiceStatus } from "@billow/db/enums";
import { describe, expect, it } from "vitest";
import {
  deriveInvoiceStatus,
  invoiceAttentionLabel,
  invoiceStatusLabel,
  isScheduledInvoice,
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

  it("stays quiet about an invoice scheduled to go out later", () => {
    const future = new Date();
    future.setDate(future.getDate() + 7);

    expect(
      invoiceAttentionLabel({
        currentStatus: InvoiceStatus.SENT,
        sentAt: future,
        approvedAt: null,
        paidAt: null,
        cfdiIssuedAt: null,
        hasCfdiXml: false,
        hasCfdiPdf: false,
      }),
    ).toBeNull();
  });

  it("still asks for approval once the send date has passed", () => {
    const past = new Date();
    past.setDate(past.getDate() - 7);

    expect(
      invoiceAttentionLabel({
        currentStatus: InvoiceStatus.SENT,
        sentAt: past,
        approvedAt: null,
        paidAt: null,
        cfdiIssuedAt: null,
        hasCfdiXml: false,
        hasCfdiPdf: false,
      }),
    ).toBe("Record client approval");
  });
});

describe("isScheduledInvoice", () => {
  const now = new Date(2026, 7, 31); // Aug 31 2026, local.

  it("calls an invoice with a future send date scheduled", () => {
    // Recording "sent to client" ahead of time is how an invoice is scheduled:
    // the status column reads SENT the moment the date is saved.
    expect(
      isScheduledInvoice(InvoiceStatus.SENT, new Date(2026, 8, 15), now),
    ).toBe(true);
  });

  it("does not call an invoice sent today scheduled", () => {
    // The comparison is by day: today's invoice has gone out.
    expect(
      isScheduledInvoice(InvoiceStatus.SENT, new Date(2026, 7, 31), now),
    ).toBe(false);
  });

  it("does not call a past send date scheduled", () => {
    expect(
      isScheduledInvoice(InvoiceStatus.SENT, new Date(2026, 7, 1), now),
    ).toBe(false);
  });

  it("leaves every other status alone", () => {
    // Once the invoice moves past SENT, a future send date is a typo to fix,
    // not a schedule — the later facts already happened.
    const future = new Date(2026, 8, 15);
    expect(isScheduledInvoice(InvoiceStatus.DRAFT, future, now)).toBe(false);
    expect(isScheduledInvoice(InvoiceStatus.APPROVED, future, now)).toBe(false);
    expect(isScheduledInvoice(InvoiceStatus.PAID, future, now)).toBe(false);
    expect(isScheduledInvoice(InvoiceStatus.VOID, future, now)).toBe(false);
  });

  it("is never scheduled without a send date", () => {
    expect(isScheduledInvoice(InvoiceStatus.SENT, null, now)).toBe(false);
  });

  it("reads a date-only string as the day it names", () => {
    // Through the Date constructor "2026-09-01" is UTC midnight, which is
    // Aug 31 in Mexico City — the same day as `now`, and so not scheduled.
    expect(isScheduledInvoice(InvoiceStatus.SENT, "2026-09-01", now)).toBe(
      true,
    );
  });
});

describe("invoiceStatusLabel", () => {
  it("turns enum values into readable labels", () => {
    expect(invoiceStatusLabel(InvoiceStatus.TAX_RECEIPT)).toBe("Tax receipt");
    expect(invoiceStatusLabel(InvoiceStatus.TAX_RETURN)).toBe("Tax return");
  });
});
