import { z } from "zod";

import { toDateInputValue } from "@/lib/date-only";

/**
 * Shapes returned for an invoice. Also feeds the OpenAPI document.
 *
 * `id` is the opaque `publicId`; the serial primary key never leaves the
 * server. Dates follow the same split as tax periods: `invoiceDate` and the
 * four progress milestones are calendar days as `YYYY-MM-DD`, while
 * `createdAt`/`updatedAt` are real instants and stay ISO. See lib/date-only.ts
 * for why mixing the two shifts an invoice a day west of UTC.
 */
const money = (description: string) => z.number().meta({ description });

export const invoiceLineItemResponseSchema = z.object({
  description: z.string().meta({ description: "What was billed." }),
  note: z.string().nullable().meta({ description: "Free-form note, or null." }),
  quantity: money("Quantity billed."),
  rate: money("Unit rate."),
  amount: money("quantity x rate, rounded the way the column stores it."),
  position: z
    .number()
    .int()
    .meta({ description: "Order on the invoice, from zero." }),
});

export const invoiceDocumentResponseSchema = z.object({
  id: z.number().int().meta({ description: "Stable document identifier." }),
  kind: z
    .string()
    .meta({ description: 'Either "CFDI_XML", "CFDI_PDF" or "OTHER".' }),
  uploadId: z.string().meta({
    description: "Upload holding the bytes. Fetch from /api/v1/uploads/{id}.",
  }),
  filename: z.string().meta({ description: "Display filename." }),
  contentType: z
    .string()
    .meta({ description: "MIME type detected from the bytes." }),
  size: z.number().int().meta({ description: "Size in bytes." }),
  note: z.string().nullable().meta({ description: "Free-form note, or null." }),
});

const invoiceCore = {
  id: z.string().meta({
    description: "Opaque invoice identifier, a UUID. Use it in URLs.",
  }),
  invoiceNumber: z
    .number()
    .int()
    .meta({ description: "Per-account invoice number. Unique." }),
  invoiceDate: z
    .string()
    .meta({ description: "Calendar day of issue, YYYY-MM-DD." }),
  status: z.string().meta({
    description:
      "DRAFT, SENT, APPROVED, PAID, TAX_RECEIPT, TAX_RETURN, DONE or VOID.",
  }),
  currency: z
    .string()
    .meta({ description: "Currency the invoice is billed in." }),
  notes: z.string().nullable().meta({ description: "Free-form notes." }),
  sentAt: z.string().nullable().meta({ description: "Day sent, or null." }),
  approvedAt: z
    .string()
    .nullable()
    .meta({ description: "Day the client approved, or null." }),
  paidAt: z.string().nullable().meta({ description: "Day paid, or null." }),
  cfdiIssuedAt: z
    .string()
    .nullable()
    .meta({ description: "Day the CFDI was issued, or null." }),
  total: money("Sum of the line items."),
  client: z.object({
    id: z.number().int(),
    name: z.string(),
  }),
  createdAt: z.string().meta({ description: "ISO timestamp." }),
  updatedAt: z.string().meta({ description: "ISO timestamp." }),
};

export const invoiceSummaryResponseSchema = z.object(invoiceCore);

export const invoiceDetailResponseSchema = z.object({
  ...invoiceCore,
  lineItems: z.array(invoiceLineItemResponseSchema),
  documents: z.array(invoiceDocumentResponseSchema).meta({
    description:
      "CFDI and other attachments, read-only here — they are attached through the invoice workflow.",
  }),
});

export const invoiceListResponseSchema = z.object({
  invoices: z.array(invoiceSummaryResponseSchema),
  count: z
    .number()
    .int()
    .meta({ description: "Total invoices on the account." }),
  truncated: z.boolean().meta({
    description: "True when count exceeds the page this response carries.",
  }),
});

export type InvoiceSummaryResponse = z.infer<
  typeof invoiceSummaryResponseSchema
>;
export type InvoiceDetailResponse = z.infer<typeof invoiceDetailResponseSchema>;

type Decimalish = { toNumber(): number };

type LineItemRow = {
  description: string;
  note: string | null;
  quantity: Decimalish;
  rate: Decimalish;
  amount: Decimalish;
  position: number;
};

type InvoiceRow = {
  publicId: string;
  invoiceNumber: number;
  invoiceDate: Date;
  status: string;
  currency: string;
  notes: string | null;
  sentAt: Date | null;
  approvedAt: Date | null;
  paidAt: Date | null;
  cfdiIssuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  clientCompany: { id: number; name: string };
  total: number;
};

type InvoiceDetailRow = InvoiceRow & {
  lineItems: LineItemRow[];
  documents: Array<{
    id: number;
    kind: string;
    uploadId: string;
    note: string | null;
    upload: { filename: string; contentType: string; size: number };
  }>;
};

const day = (value: Date | null) =>
  value === null ? null : toDateInputValue(value);

/** Prisma returns money as Decimal, which JSON.stringify renders as an object. */
const amount = (value: Decimalish) => value.toNumber();

function core(invoice: InvoiceRow): InvoiceSummaryResponse {
  return {
    id: invoice.publicId,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: toDateInputValue(invoice.invoiceDate),
    status: invoice.status,
    currency: invoice.currency,
    notes: invoice.notes,
    sentAt: day(invoice.sentAt),
    approvedAt: day(invoice.approvedAt),
    paidAt: day(invoice.paidAt),
    cfdiIssuedAt: day(invoice.cfdiIssuedAt),
    // An invoice has no total column; the rules layer sums its line items.
    total: invoice.total,
    client: { id: invoice.clientCompany.id, name: invoice.clientCompany.name },
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

export function toInvoiceSummaryResponse(
  invoice: InvoiceRow,
): InvoiceSummaryResponse {
  return core(invoice);
}

export function toInvoiceDetailResponse(
  invoice: InvoiceDetailRow,
): InvoiceDetailResponse {
  return {
    ...core(invoice),
    lineItems: invoice.lineItems.map((item) => ({
      description: item.description,
      note: item.note,
      quantity: amount(item.quantity),
      rate: amount(item.rate),
      amount: amount(item.amount),
      position: item.position,
    })),
    documents: invoice.documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      uploadId: document.uploadId,
      filename: document.upload.filename,
      contentType: document.upload.contentType,
      size: document.upload.size,
      note: document.note,
    })),
  };
}
