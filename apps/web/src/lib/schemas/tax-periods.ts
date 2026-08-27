import { z } from "zod";

import { toDateInputValue } from "@/lib/date-only";

/**
 * Shape returned for a monthly tax filing. Also feeds the OpenAPI document.
 *
 * Note the two date formats, which are not interchangeable. `filedAt` and
 * `paidAt` are calendar days and go out as `YYYY-MM-DD`; serialising them as
 * ISO instants would hand a caller "2026-03-01T06:00:00.000Z" for a March 1
 * filing and invite it to render February 28 — the exact bug
 * `lib/date-only.ts` exists to prevent. `createdAt` and `updatedAt` really are
 * instants and stay ISO.
 */
export const taxPeriodDocumentResponseSchema = z.object({
  id: z.number().int().meta({ description: "Stable document identifier." }),
  kind: z.string().meta({
    description:
      'What the document is: "TAX_RETURN", "PAYMENT_CONFIRMATION" or "OTHER".',
  }),
  uploadId: z.string().meta({
    description:
      "The upload holding the bytes. Fetch it from /api/v1/uploads/{id}.",
  }),
  note: z.string().nullable().meta({ description: "Free-form note, or null." }),
  createdAt: z
    .string()
    .meta({ description: "When it was attached, as an ISO timestamp." }),
});

export const taxPeriodResponseSchema = z.object({
  id: z.number().int().meta({ description: "Stable period identifier." }),
  year: z.number().int().meta({ description: "Calendar year." }),
  month: z.number().int().meta({ description: "Calendar month, 1-12." }),
  currency: z.string().meta({ description: "Currency of amountPaid." }),
  amountPaid: z.number().nullable().meta({
    description: "Tax paid for the month, or null when not yet paid.",
  }),
  filedAt: z.string().nullable().meta({
    description:
      "Calendar day the return was filed, as YYYY-MM-DD, or null. Not a timestamp.",
  }),
  paidAt: z.string().nullable().meta({
    description:
      "Calendar day the tax was paid, as YYYY-MM-DD, or null. Not a timestamp.",
  }),
  notes: z.string().nullable().meta({ description: "Free-form notes." }),
  documents: z.array(taxPeriodDocumentResponseSchema).meta({
    description:
      "Attached documents, read-only here — they are managed through the invoice workflow, which enforces that a filing carries its return.",
  }),
  createdAt: z.string().meta({ description: "ISO timestamp." }),
  updatedAt: z.string().meta({ description: "ISO timestamp." }),
});

export const taxPeriodListResponseSchema = z.object({
  taxPeriods: z.array(taxPeriodResponseSchema),
});

export type TaxPeriodResponse = z.infer<typeof taxPeriodResponseSchema>;

type TaxPeriodRow = {
  id: number;
  year: number;
  month: number;
  currency: string;
  amountPaid: { toNumber(): number } | null;
  filedAt: Date | null;
  paidAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  documents: Array<{
    id: number;
    kind: string;
    uploadId: string;
    note: string | null;
    createdAt: Date;
  }>;
};

/** Row to response. The single place the API's tax-period shape is decided. */
export function toTaxPeriodResponse(period: TaxPeriodRow): TaxPeriodResponse {
  return {
    id: period.id,
    year: period.year,
    month: period.month,
    currency: period.currency,
    // Postgres returns Decimal, which JSON.stringify would render as an object.
    amountPaid:
      period.amountPaid === null ? null : period.amountPaid.toNumber(),
    filedAt: period.filedAt === null ? null : toDateInputValue(period.filedAt),
    paidAt: period.paidAt === null ? null : toDateInputValue(period.paidAt),
    notes: period.notes,
    documents: period.documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      uploadId: document.uploadId,
      note: document.note,
      createdAt: document.createdAt.toISOString(),
    })),
    createdAt: period.createdAt.toISOString(),
    updatedAt: period.updatedAt.toISOString(),
  };
}
