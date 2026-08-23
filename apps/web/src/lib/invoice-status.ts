import {
  InvoiceStatus,
  type InvoiceStatus as InvoiceStatusValue,
} from "@billow/db/enums";

export const INVOICE_STATUS_SEQUENCE = [
  InvoiceStatus.DRAFT,
  InvoiceStatus.SENT,
  InvoiceStatus.APPROVED,
  InvoiceStatus.PAID,
  InvoiceStatus.TAX_RECEIPT,
  InvoiceStatus.DONE,
] as const satisfies readonly InvoiceStatusValue[];

export const PAID_INVOICE_STATUSES = [
  InvoiceStatus.PAID,
  InvoiceStatus.TAX_RECEIPT,
  InvoiceStatus.TAX_RETURN,
  InvoiceStatus.DONE,
] as const satisfies readonly InvoiceStatusValue[];

export const CLOSED_INVOICE_STATUSES = [
  ...PAID_INVOICE_STATUSES,
  InvoiceStatus.VOID,
] as const satisfies readonly InvoiceStatusValue[];

export function parseInvoiceStatus(value: string | null | undefined) {
  const status = value?.trim() || InvoiceStatus.DRAFT;
  if (Object.values(InvoiceStatus).includes(status as InvoiceStatusValue)) {
    return status as InvoiceStatusValue;
  }

  throw new Error(`Unsupported invoice status: ${status}`);
}

export function nextInvoiceStatus(
  status: InvoiceStatusValue,
): InvoiceStatusValue | null {
  const index = INVOICE_STATUS_SEQUENCE.indexOf(
    status as (typeof INVOICE_STATUS_SEQUENCE)[number],
  );
  return index < 0 ? null : (INVOICE_STATUS_SEQUENCE[index + 1] ?? null);
}

export function previousInvoiceStatus(
  status: InvoiceStatusValue,
): InvoiceStatusValue | null {
  const index = INVOICE_STATUS_SEQUENCE.indexOf(
    status as (typeof INVOICE_STATUS_SEQUENCE)[number],
  );
  return index <= 0 ? null : (INVOICE_STATUS_SEQUENCE[index - 1] ?? null);
}

export function invoiceStatusLabel(status: InvoiceStatusValue): string {
  const words = status.toLowerCase().split("_");
  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

export type InvoiceProgressState = {
  currentStatus: InvoiceStatusValue;
  sentAt: Date | string | null;
  approvedAt: Date | string | null;
  paidAt: Date | string | null;
  cfdiIssuedAt: Date | string | null;
  hasCfdiXml: boolean;
  hasCfdiPdf: boolean;
};

/**
 * The status column is a query-friendly summary of the dated progress facts.
 * Void remains an explicit exception; every other status is recomputed after
 * a workflow write so correcting a date or replacing a document cannot leave
 * the badge out of step with the record.
 */
export function deriveInvoiceStatus(
  state: InvoiceProgressState,
): InvoiceStatusValue {
  if (state.currentStatus === InvoiceStatus.VOID) return InvoiceStatus.VOID;
  if (state.cfdiIssuedAt && state.hasCfdiXml && state.hasCfdiPdf) {
    return InvoiceStatus.DONE;
  }
  if (state.cfdiIssuedAt || state.hasCfdiXml || state.hasCfdiPdf) {
    return InvoiceStatus.TAX_RECEIPT;
  }
  if (state.paidAt) return InvoiceStatus.PAID;
  if (state.approvedAt) return InvoiceStatus.APPROVED;
  if (state.sentAt) return InvoiceStatus.SENT;
  return InvoiceStatus.DRAFT;
}

export function invoiceAttentionLabel(state: InvoiceProgressState) {
  if (state.currentStatus === InvoiceStatus.VOID) return null;
  if (state.sentAt === null) return "Record when the invoice was sent";
  if (state.approvedAt === null) return "Record client approval";
  if (state.paidAt === null) return "Record payment";
  if (state.cfdiIssuedAt === null || !state.hasCfdiXml || !state.hasCfdiPdf) {
    return "Complete the fiscal invoice (CFDI)";
  }
  return null;
}
