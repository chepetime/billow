import { z } from "zod";

import { parseDateOnly } from "@/lib/date-only";

/**
 * The invoicing workspace's form contracts: sender profiles, bank accounts,
 * client companies, and invoices.
 *
 * These are the single source of truth in both directions — the client form
 * resolver and the server action both parse against them, so a payload that
 * skipped the browser is validated exactly as one that did not.
 */

/**
 * `Decimal(12, 2)` in Postgres. Anything with more precision than that is
 * rounded on write, so it is rejected here instead: silently turning 10.005
 * into 10.01 on an invoice is the kind of thing noticed a quarter later.
 */
const MAX_MONEY = 9_999_999_999.99;

/**
 * A number that may arrive as a string.
 *
 * Every one of these is bound to a form control, and a control hands back a
 * string unless the register call remembers `valueAsNumber` — which, forgotten
 * once, yields `"1000"` where a number is expected and a confusing failure two
 * layers down. Accepting both here makes the register call's option irrelevant
 * and gives an empty field one message instead of a NaN.
 */
function numeric(label: string) {
  return z.union([z.number(), z.string()]).transform((value, ctx) => {
    const parsed = typeof value === "string" ? Number(value.trim()) : value;

    if (typeof value === "string" && value.trim() === "") {
      ctx.addIssue({ code: "custom", message: `${label} is required.` });
      return z.NEVER;
    }

    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: "custom", message: `${label} must be a number.` });
      return z.NEVER;
    }

    return parsed;
  });
}

function money(label: string) {
  return numeric(label).pipe(
    z
      .number()
      .refine((value) => Math.abs(value) <= MAX_MONEY, `${label} is too large.`)
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
        `${label} cannot have more than two decimal places.`,
      ),
  );
}

/** A foreign key chosen from a `<select>`, which submits its value as text. */
function recordId(message: string) {
  return numeric(message).pipe(z.number().int().positive(message));
}

/** Trim, then treat "" as absent. Optional text fields are null in the database. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length > 0 ? value : null))
    .nullable();

const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required.`).max(max);

/** Parsed with `parseDateOnly` so the stored instant is local midnight. */
export const dateOnlySchema = z
  .string()
  .trim()
  .refine((value) => parseDateOnly(value) !== null, "Enter a valid date.");

/**
 * The first picker's currencies. Not an enum in the database — an invoice
 * stores whatever code it was created with, so widening this list later does
 * not need a migration.
 */
export const CURRENCIES = ["MXN", "USD", "CAD", "EUR"] as const;

export const currencySchema = z.enum(CURRENCIES, {
  error: "Choose a currency.",
});

export const senderProfileSchema = z.object({
  displayName: requiredText("Display name", 120),
  legalName: requiredText("Legal name", 160),
  email: z.email("Enter a valid email address."),
  address: requiredText("Address", 400),
  taxId: optionalText(60),
  department: optionalText(120),
  manager: optionalText(120),
});

export const bankAccountSchema = z.object({
  userProfileId: recordId("Choose a sender profile."),
  label: requiredText("Label", 80),
  bankName: requiredText("Bank name", 120),
  accountHolderName: requiredText("Account holder name", 160),
  accountNumber: requiredText("Account number", 80),
  bankAddress: optionalText(300),
  bankPhone: optionalText(60),
  accountHolderAddress: optionalText(300),
  accountType: optionalText(60),
  institutionNumber: optionalText(40),
  transitNumber: optionalText(40),
  routingNumber: optionalText(40),
  swift: optionalText(40),
  iban: optionalText(60),
  clabe: optionalText(40),
  isDefault: z.boolean(),
});

export const clientCompanySchema = z.object({
  name: requiredText("Company name", 160),
  legalName: optionalText(200),
  address1: requiredText("Address", 200),
  address2: optionalText(200),
  cityStatePostal: requiredText("City, state, postal code", 200),
  country: requiredText("Country", 100),
  email: z.email("Enter a valid email address."),
  attentionTo: optionalText(120),
  notes: optionalText(1000),
});

export const invoiceLineItemSchema = z.object({
  description: requiredText("Description", 300),
  note: optionalText(1000),
  quantity: money("Quantity"),
  rate: money("Rate"),
});

export const invoiceSchema = z.object({
  userProfileId: recordId("Choose a sender profile."),
  bankAccountId: recordId("Choose a bank account."),
  clientCompanyId: recordId("Choose a client."),
  invoiceNumber: numeric("Invoice number").pipe(
    z
      .number()
      .int("Invoice number must be a whole number.")
      .positive("Invoice number must be greater than zero.")
      .max(1_000_000_000),
  ),
  invoiceDate: dateOnlySchema,
  currency: currencySchema,
  status: z.enum(["DRAFT", "SENT", "PAID", "VOID"]),
  notes: optionalText(2000),
  lineItems: z
    .array(invoiceLineItemSchema)
    .min(1, "Add at least one line item.")
    .max(50, "An invoice can hold at most 50 line items."),
});

export type SenderProfileInput = z.infer<typeof senderProfileSchema>;
export type BankAccountInput = z.infer<typeof bankAccountSchema>;
export type ClientCompanyInput = z.infer<typeof clientCompanySchema>;
export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemSchema>;
export type InvoiceInput = z.infer<typeof invoiceSchema>;

/**
 * The form's shape *before* the schema's transforms run: optional text is a
 * string in the DOM and becomes `string | null` only on the way out. Without
 * this distinction `useForm` is typed with the output and every optional input
 * has to be cast at the call site.
 */
export type SenderProfileFormValues = z.input<typeof senderProfileSchema>;
export type BankAccountFormValues = z.input<typeof bankAccountSchema>;
export type ClientCompanyFormValues = z.input<typeof clientCompanySchema>;
export type InvoiceFormValues = z.input<typeof invoiceSchema>;

/** An invoice's total, from the same rounding rule the database column uses. */
export function lineItemAmount(quantity: number, rate: number): number {
  return Math.round(quantity * rate * 100) / 100;
}

export function invoiceTotal(
  lineItems: readonly { quantity: number; rate: number }[],
): number {
  const cents = lineItems.reduce(
    (sum, item) =>
      sum + Math.round(lineItemAmount(item.quantity, item.rate) * 100),
    0,
  );
  return cents / 100;
}
