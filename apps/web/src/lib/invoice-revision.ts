/**
 * Invoice revisions: what a save changed, in a sentence.
 *
 * Pure on purpose. The payload stored alongside this summary is the whole
 * before/after snapshot — enough to reconstruct the invoice — and this text is
 * only what the history list shows. Keeping the two separate means a wording
 * change never costs the reconstructable record.
 */

import { toDateInputValue } from "@/lib/date-only";

export type InvoiceSnapshot = {
  invoiceNumber: number;
  invoiceDate: string;
  currency: string;
  status: string;
  sentAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  cfdiIssuedAt: string | null;
  notes: string | null;
  userProfileId: number;
  bankAccountId: number;
  clientCompanyId: number;
  lineItems: {
    description: string;
    note: string | null;
    quantity: number;
    rate: number;
    amount: number;
  }[];
};

const FIELD_LABELS: Record<string, string> = {
  invoiceNumber: "invoice number",
  invoiceDate: "date",
  currency: "currency",
  status: "status",
  sentAt: "sent date",
  approvedAt: "approval date",
  paidAt: "payment date",
  cfdiIssuedAt: "CFDI issued date",
  notes: "notes",
  userProfileId: "sender",
  bankAccountId: "bank account",
  clientCompanyId: "client",
};

export function toStoredInvoiceSnapshot(invoice: {
  invoiceNumber: number;
  invoiceDate: Date;
  currency: string;
  status: string;
  sentAt: Date | null;
  approvedAt: Date | null;
  paidAt: Date | null;
  cfdiIssuedAt: Date | null;
  notes: string | null;
  userProfileId: number;
  bankAccountId: number;
  clientCompanyId: number;
  lineItems: Array<{
    description: string;
    note: string | null;
    quantity: unknown;
    rate: unknown;
    amount: unknown;
  }>;
}): InvoiceSnapshot {
  return {
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: toDateInputValue(invoice.invoiceDate),
    currency: invoice.currency,
    status: invoice.status,
    sentAt: invoice.sentAt ? toDateInputValue(invoice.sentAt) : null,
    approvedAt: invoice.approvedAt
      ? toDateInputValue(invoice.approvedAt)
      : null,
    paidAt: invoice.paidAt ? toDateInputValue(invoice.paidAt) : null,
    cfdiIssuedAt: invoice.cfdiIssuedAt
      ? toDateInputValue(invoice.cfdiIssuedAt)
      : null,
    notes: invoice.notes,
    userProfileId: invoice.userProfileId,
    bankAccountId: invoice.bankAccountId,
    clientCompanyId: invoice.clientCompanyId,
    lineItems: invoice.lineItems.map((item) => ({
      description: item.description,
      note: item.note,
      quantity: Number(item.quantity),
      rate: Number(item.rate),
      amount: Number(item.amount),
    })),
  };
}

function totalOf(snapshot: InvoiceSnapshot) {
  const cents = snapshot.lineItems.reduce(
    (sum, item) => sum + Math.round(item.amount * 100),
    0,
  );
  return cents / 100;
}

function sameLineItems(before: InvoiceSnapshot, after: InvoiceSnapshot) {
  if (before.lineItems.length !== after.lineItems.length) return false;

  return before.lineItems.every((item, index) => {
    const other = after.lineItems[index];
    if (!other) return false;
    return (
      item.description === other.description &&
      item.note === other.note &&
      item.quantity === other.quantity &&
      item.rate === other.rate
    );
  });
}

/**
 * A readable summary of one save.
 *
 * Returns "No changes." rather than an empty string when nothing moved: a
 * revision row is still written for the timestamp, and a blank summary in the
 * history list reads as a rendering bug.
 */
export function summarizeInvoiceChanges(
  before: InvoiceSnapshot,
  after: InvoiceSnapshot,
): string {
  const changed = Object.keys(FIELD_LABELS).filter((key) => {
    const field = key as keyof typeof FIELD_LABELS;
    return (
      before[field as keyof InvoiceSnapshot] !==
      after[field as keyof InvoiceSnapshot]
    );
  });

  const parts = changed.map((key) => FIELD_LABELS[key] as string);

  if (!sameLineItems(before, after)) {
    const from = before.lineItems.length;
    const to = after.lineItems.length;
    parts.push(
      from === to
        ? `line items (total ${totalOf(before).toFixed(2)} → ${totalOf(after).toFixed(2)})`
        : `line items (${from} → ${to})`,
    );
  }

  if (parts.length === 0) return "No changes.";

  const list =
    parts.length === 1
      ? (parts[0] as string)
      : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

  return `Updated ${list}.`;
}
