import { z } from "zod";

/**
 * The income summary's response shape. Feeds the OpenAPI document only — the
 * value itself is built by `lib/income-summary.ts`, which is where the logic
 * and its tests live.
 */
const currencyAmountSchema = z.object({
  currency: z
    .string()
    .meta({ description: "ISO code the invoices were billed in." }),
  amount: z.number().meta({
    description:
      "Sum for this currency alone. Never combined with another currency — no exchange rate is stored.",
  }),
  invoiceCount: z
    .number()
    .int()
    .meta({ description: "Invoices contributing to this amount." }),
});

export const incomeSummaryResponseSchema = z.object({
  year: z.number().int().meta({ description: "Calendar year summarised." }),
  currencies: z.array(z.string()).meta({
    description: "Every currency the year billed in, sorted.",
  }),
  months: z
    .array(
      z.object({
        year: z.number().int(),
        month: z.number().int().meta({ description: "1-12." }),
        invoiced: z.array(currencyAmountSchema),
        paid: z.array(currencyAmountSchema).meta({
          description:
            "The subset already paid — status PAID, TAX_RECEIPT, TAX_RETURN or DONE.",
        }),
        cfdi: z.object({
          issued: z.number().int(),
          missing: z.number().int(),
        }),
        taxPeriod: z
          .object({
            filedAt: z.string().nullable().meta({ description: "YYYY-MM-DD." }),
            paidAt: z.string().nullable().meta({ description: "YYYY-MM-DD." }),
            amountPaid: z.number().nullable(),
            currency: z.string(),
            hasReturn: z.boolean(),
            hasPaymentConfirmation: z.boolean(),
          })
          .nullable()
          .meta({ description: "Null when no filing record exists yet." }),
      }),
    )
    .meta({
      description:
        "All twelve months, including empty ones — a month with no invoices is itself an answer.",
    }),
  totals: z.object({
    invoiced: z.array(currencyAmountSchema),
    paid: z.array(currencyAmountSchema),
  }),
});
