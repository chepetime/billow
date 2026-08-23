import { z } from "zod";

import {
  currencySchema,
  dateOnlySchema,
  invoicePublicIdSchema,
} from "@/lib/schemas/workspace";

const uploadIdSchema = z.string().trim().min(1).nullable().optional();

const amountPaidSchema = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const amount = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(amount) || amount < 0) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid amount paid.",
      });
      return z.NEVER;
    }
    if (Math.abs(amount * 100 - Math.round(amount * 100)) >= 1e-9) {
      ctx.addIssue({
        code: "custom",
        message: "Amount paid cannot have more than two decimal places.",
      });
      return z.NEVER;
    }
    return amount;
  })
  .pipe(z.number().max(9_999_999_999.99));

export const invoiceWorkflowCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("milestone"),
    invoiceId: invoicePublicIdSchema,
    milestone: z.enum(["sentAt", "approvedAt", "paidAt"]),
    date: dateOnlySchema.nullable(),
  }),
  z.object({
    type: z.literal("cfdi"),
    invoiceId: invoicePublicIdSchema,
    issuedOn: dateOnlySchema,
    xmlUploadId: uploadIdSchema,
    pdfUploadId: uploadIdSchema,
  }),
  z.object({
    type: z.literal("clear-cfdi"),
    invoiceId: invoicePublicIdSchema,
  }),
  z.object({
    type: z.literal("tax-filing"),
    invoiceId: invoicePublicIdSchema,
    filedOn: dateOnlySchema,
    returnUploadId: uploadIdSchema,
  }),
  z.object({
    type: z.literal("tax-payment"),
    invoiceId: invoicePublicIdSchema,
    paidOn: dateOnlySchema,
    amountPaid: amountPaidSchema,
    currency: currencySchema,
    confirmationUploadId: uploadIdSchema,
  }),
]);

export type InvoiceWorkflowCommand = z.input<
  typeof invoiceWorkflowCommandSchema
>;
