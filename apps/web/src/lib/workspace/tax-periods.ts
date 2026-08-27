import "server-only";

import { parseDateOnly } from "@/lib/date-only";
import { taxPeriodSchema } from "@/lib/schemas/workspace";
import {
  refuse,
  refuseFromError,
  succeed,
  type WorkspaceResult,
} from "@/lib/workspace/result";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

/**
 * Monthly tax filings.
 *
 * Same contract as `lib/workspace/clients.ts`: the owner is an argument, input
 * arrives as `unknown` and is parsed here, and a refusal carries a reason.
 *
 * These rules own the *period record* — the month, what was paid, when it was
 * filed. They deliberately do not attach documents: `lib/actions/
 * invoice-workflow.ts` owns that, because attaching a filed return is a step in
 * an invoice's lifecycle and carries invariants this layer has no invoice to
 * check (a filing must end with a TAX_RETURN document; a payment with a
 * PAYMENT_CONFIRMATION). Splitting a rule away from the invariant that makes it
 * correct is how the two ways in start disagreeing, so documents stay
 * read-only here.
 */

/** No encrypted column on this model, so the keyless client is complete. */
const documentSelection = {
  select: {
    id: true,
    kind: true,
    uploadId: true,
    note: true,
    createdAt: true,
  },
  orderBy: { kind: "asc" },
} as const;

const withDocuments = { documents: documentSelection } as const;

/**
 * Schema-valid input to database columns.
 *
 * The date strings become **local** midnight through `parseDateOnly`, never
 * `new Date(value)`. That is the whole point of `lib/date-only.ts`: the
 * built-in parser reads "2026-03-01" as UTC midnight, which renders as
 * February 28 anywhere west of it and drops the row out of its own month. The
 * schema already proved both strings parse, so a null here means the caller
 * sent null.
 */
function toColumns(input: ReturnType<typeof taxPeriodSchema.parse>) {
  return {
    year: input.year,
    month: input.month,
    currency: input.currency,
    amountPaid: input.amountPaid,
    filedAt: input.filedAt === null ? null : parseDateOnly(input.filedAt),
    paidAt: input.paidAt === null ? null : parseDateOnly(input.paidAt),
    notes: input.notes,
  };
}

export async function listTaxPeriods(userId: string) {
  const { prisma } = await getWorkspacePrisma();
  return prisma.taxPeriod.findMany({
    where: { userId },
    include: withDocuments,
    // Most recent month first: the period anyone is asking about is almost
    // always the one just closed.
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

export type TaxPeriodRecord = Awaited<
  ReturnType<typeof listTaxPeriods>
>[number];

export async function getTaxPeriod(
  userId: string,
  id: number,
): Promise<WorkspaceResult<TaxPeriodRecord>> {
  try {
    const { prisma } = await getWorkspacePrisma();
    const period = await prisma.taxPeriod.findFirst({
      where: { id, userId },
      include: withDocuments,
    });
    return period === null ? refuse("not_found") : succeed(period);
  } catch (error) {
    return refuseFromError("getTaxPeriod", error);
  }
}

/**
 * Writes return the stored record, documents included, so a caller does not
 * have to read it back — that re-read was the same four lines in every route.
 */
export async function createTaxPeriod(
  userId: string,
  input: unknown,
): Promise<WorkspaceResult<TaxPeriodRecord>> {
  const parsed = taxPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return refuse("invalid", parsed.error.flatten().fieldErrors);
  }

  try {
    const { prisma } = await getWorkspacePrisma();
    // `create` returns the row, so this stays one round trip.
    const period = await prisma.taxPeriod.create({
      data: { ...toColumns(parsed.data), userId },
      include: withDocuments,
    });
    return succeed(period);
  } catch (error) {
    // A second period for the same month violates the unique constraint and
    // comes back as `conflict`, which is the honest answer: the caller asked
    // to create something that already exists, and an upsert here would
    // silently overwrite a filing record.
    return refuseFromError("createTaxPeriod", error);
  }
}

export async function updateTaxPeriod(
  userId: string,
  id: number,
  input: unknown,
): Promise<WorkspaceResult<TaxPeriodRecord>> {
  const parsed = taxPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return refuse("invalid", parsed.error.flatten().fieldErrors);
  }

  try {
    const { prisma } = await getWorkspacePrisma();
    // The owner rides in the write's own filter, so the ownership check and
    // the update are one statement. updateMany returns a count rather than the
    // row, hence the read that follows.
    const { count } = await prisma.taxPeriod.updateMany({
      where: { id, userId },
      data: toColumns(parsed.data),
    });
    if (count === 0) return refuse("not_found");

    return getTaxPeriod(userId, id);
  } catch (error) {
    // Moving a period onto a month that already has one is a conflict, same
    // constraint as create.
    return refuseFromError("updateTaxPeriod", error);
  }
}

/**
 * Deletes a period, refusing while any document is attached.
 *
 * `TaxPeriodDocument.taxPeriodId` is `onDelete: Cascade`, so the database would
 * happily take the filed return and the payment confirmation down with the
 * period and leave their `Upload` rows behind as orphans. `ClientCompany` gets
 * the same protection from `onDelete: Restrict` for free; this model does not,
 * so the rule supplies it.
 *
 * That is what keeps DELETE safe to expose to an API key that carries no
 * scopes: the destructive case is refused, and detaching the documents is a
 * deliberate act through the invoice workflow.
 */
export async function deleteTaxPeriod(
  userId: string,
  id: number,
): Promise<WorkspaceResult> {
  try {
    const { prisma } = await getWorkspacePrisma();
    const period = await prisma.taxPeriod.findFirst({
      where: { id, userId },
      select: { id: true, _count: { select: { documents: true } } },
    });
    if (!period) return refuse("not_found");
    if (period._count.documents > 0) return refuse("in_use");

    // Scoped by owner again rather than by the id just read: the check above
    // is not a lock, and deleting by id alone would be a different query than
    // the one that proved ownership.
    const { count } = await prisma.taxPeriod.deleteMany({
      where: { id, userId },
    });
    return count === 0 ? refuse("not_found") : succeed();
  } catch (error) {
    return refuseFromError("deleteTaxPeriod", error);
  }
}
