"use server";

import { requireSession } from "@billow/auth";
import { revalidatePath } from "next/cache";

import {
  type ActionResult,
  fail,
  ok,
  toActionError,
} from "@/lib/actions/result";
import { parseDateOnly } from "@/lib/date-only";
import {
  type InvoiceSnapshot,
  summarizeInvoiceChanges,
  toStoredInvoiceSnapshot,
} from "@/lib/invoice-revision";
import {
  type InvoiceInput,
  invoicePublicIdSchema,
  invoiceSchema,
  lineItemAmount,
} from "@/lib/schemas/workspace";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

/**
 * Invoice create, update and delete.
 *
 * `Invoice` holds no encrypted column itself, but it is written alongside
 * models that do and it reads them back through the same client, so it uses
 * `getWorkspacePrisma()` like everything else in this directory.
 */

const DUPLICATE_NUMBER =
  "You already have an invoice with that number. Pick another.";

function revalidate(id?: string) {
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  if (id !== undefined) {
    revalidatePath(`/invoices/${id}`);
    revalidatePath(`/invoices/${id}/edit`);
  }
}

/** Line items as the database stores them: amount derived, position from order. */
function toLineItemRows(lineItems: InvoiceInput["lineItems"]) {
  return lineItems.map((item, position) => ({
    description: item.description,
    note: item.note,
    quantity: item.quantity,
    rate: item.rate,
    amount: lineItemAmount(item.quantity, item.rate),
    position,
  }));
}

function toSnapshot(
  input: InvoiceInput,
  rows: ReturnType<typeof toLineItemRows>,
  progress: Pick<
    InvoiceSnapshot,
    "sentAt" | "approvedAt" | "paidAt" | "cfdiIssuedAt"
  > = {
    sentAt: null,
    approvedAt: null,
    paidAt: null,
    cfdiIssuedAt: null,
  },
): InvoiceSnapshot {
  return {
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    currency: input.currency,
    status: input.status,
    ...progress,
    notes: input.notes,
    userProfileId: input.userProfileId,
    bankAccountId: input.bankAccountId,
    clientCompanyId: input.clientCompanyId,
    lineItems: rows.map(({ position: _position, ...item }) => item),
  };
}

export async function createInvoice(
  input: InvoiceInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.");

  const invoiceDate = parseDateOnly(parsed.data.invoiceDate);
  if (!invoiceDate) return fail("Enter a valid invoice date.");

  const rows = toLineItemRows(parsed.data.lineItems);

  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();
    const userId = session.user.id;

    const id = await prisma.$transaction(async (tx) => {
      // Every referenced record is confirmed to belong to this user before it
      // is written. Without this an id typed into the form — or posted
      // straight at the action — would attach another account's bank details
      // to an invoice.
      const [profile, bankAccount, client] = await Promise.all([
        tx.userProfile.findFirst({
          where: { id: parsed.data.userProfileId, userId },
          select: { id: true },
        }),
        tx.bankAccount.findFirst({
          where: { id: parsed.data.bankAccountId, userProfile: { userId } },
          select: { id: true },
        }),
        tx.clientCompany.findFirst({
          where: { id: parsed.data.clientCompanyId, userId },
          select: { id: true },
        }),
      ]);
      if (!profile || !bankAccount || !client) return null;

      const invoice = await tx.invoice.create({
        data: {
          userId,
          invoiceNumber: parsed.data.invoiceNumber,
          invoiceDate,
          currency: parsed.data.currency,
          status: "DRAFT",
          notes: parsed.data.notes,
          userProfileId: profile.id,
          bankAccountId: bankAccount.id,
          clientCompanyId: client.id,
          lineItems: { create: rows },
        },
        select: { id: true, publicId: true },
      });

      await tx.invoiceRevision.create({
        data: {
          invoiceId: invoice.id,
          revisionNumber: 1,
          editor: session.user.name || session.user.email,
          summary: "Created invoice.",
          payload: {
            before: null,
            after: toSnapshot({ ...parsed.data, status: "DRAFT" }, rows),
          },
        },
      });

      return invoice.publicId;
    });

    if (id === null) {
      return fail(
        "The sender, bank account, or client is not in your workspace.",
      );
    }

    revalidate(id);
    return ok({ id });
  } catch (error) {
    return toActionError("createInvoice", error, { unique: DUPLICATE_NUMBER });
  }
}

export async function updateInvoice(
  id: string,
  input: InvoiceInput,
): Promise<ActionResult> {
  if (!invoicePublicIdSchema.safeParse(id).success) {
    return fail("That invoice is no longer in your workspace.");
  }

  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.");

  const invoiceDate = parseDateOnly(parsed.data.invoiceDate);
  if (!invoiceDate) return fail("Enter a valid invoice date.");

  const rows = toLineItemRows(parsed.data.lineItems);

  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();
    const userId = session.user.id;

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({
        where: { publicId: id, userId },
        include: {
          lineItems: { orderBy: { position: "asc" } },
          revisions: {
            orderBy: { revisionNumber: "desc" },
            take: 1,
            select: { revisionNumber: true },
          },
        },
      });
      if (!existing) return "missing" as const;

      const [profile, bankAccount, client] = await Promise.all([
        tx.userProfile.findFirst({
          where: { id: parsed.data.userProfileId, userId },
          select: { id: true },
        }),
        tx.bankAccount.findFirst({
          where: { id: parsed.data.bankAccountId, userProfile: { userId } },
          select: { id: true },
        }),
        tx.clientCompany.findFirst({
          where: { id: parsed.data.clientCompanyId, userId },
          select: { id: true },
        }),
      ]);
      if (!profile || !bankAccount || !client) return "foreign" as const;

      const before = toStoredInvoiceSnapshot(existing);
      const after = toSnapshot(
        { ...parsed.data, status: existing.status },
        rows,
        {
          sentAt: before.sentAt,
          approvedAt: before.approvedAt,
          paidAt: before.paidAt,
          cfdiIssuedAt: before.cfdiIssuedAt,
        },
      );

      // Replace rather than reconcile: line items have no identity a user
      // would recognise across a save — reordering two rows is
      // indistinguishable from editing both — and the revision payload is
      // what preserves the old set.
      await tx.invoiceLineItem.deleteMany({
        where: { invoiceId: existing.id },
      });

      await tx.invoice.update({
        where: { id: existing.id },
        data: {
          invoiceNumber: parsed.data.invoiceNumber,
          invoiceDate,
          currency: parsed.data.currency,
          status: existing.status,
          notes: parsed.data.notes,
          userProfileId: profile.id,
          bankAccountId: bankAccount.id,
          clientCompanyId: client.id,
          lineItems: { create: rows },
        },
      });

      await tx.invoiceRevision.create({
        data: {
          invoiceId: existing.id,
          revisionNumber: (existing.revisions[0]?.revisionNumber ?? 0) + 1,
          editor: session.user.name || session.user.email,
          summary: summarizeInvoiceChanges(before, after),
          payload: { before, after },
        },
      });

      return "saved" as const;
    });

    if (result === "missing") {
      return fail("That invoice is no longer in your workspace.");
    }
    if (result === "foreign") {
      return fail(
        "The sender, bank account, or client is not in your workspace.",
      );
    }

    revalidate(id);
    return ok();
  } catch (error) {
    return toActionError("updateInvoice", error, { unique: DUPLICATE_NUMBER });
  }
}

export async function deleteInvoice(id: string): Promise<ActionResult> {
  if (!invoicePublicIdSchema.safeParse(id).success) {
    return fail("That invoice is no longer in your workspace.");
  }

  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();

    const { count } = await prisma.invoice.deleteMany({
      where: { publicId: id, userId: session.user.id },
    });

    if (count === 0)
      return fail("That invoice is no longer in your workspace.");

    revalidate();
    return ok();
  } catch (error) {
    return toActionError("deleteInvoice", error);
  }
}

/**
 * Copy an existing invoice into a new draft: same client, sender, bank and
 * line items, with the next number and this month's end date.
 *
 * The recurring monthly invoice is the case this app exists for, and retyping
 * six line items every month is the part of the old app worth deleting.
 */
export async function duplicateInvoice(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  if (!invoicePublicIdSchema.safeParse(id).success) {
    return fail("That invoice is no longer in your workspace.");
  }

  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();
    const userId = session.user.id;

    const result = await prisma.$transaction(async (tx) => {
      const source = await tx.invoice.findFirst({
        where: { publicId: id, userId },
        include: { lineItems: { orderBy: { position: "asc" } } },
      });
      if (!source) return null;

      const highest = await tx.invoice.findFirst({
        where: { userId },
        orderBy: { invoiceNumber: "desc" },
        select: { invoiceNumber: true },
      });

      const now = new Date();
      const created = await tx.invoice.create({
        data: {
          userId,
          invoiceNumber: (highest?.invoiceNumber ?? 0) + 1,
          invoiceDate: new Date(now.getFullYear(), now.getMonth() + 1, 0),
          currency: source.currency,
          status: "DRAFT",
          notes: source.notes,
          userProfileId: source.userProfileId,
          bankAccountId: source.bankAccountId,
          clientCompanyId: source.clientCompanyId,
          lineItems: {
            create: source.lineItems.map((item) => ({
              description: item.description,
              note: item.note,
              quantity: item.quantity,
              rate: item.rate,
              amount: item.amount,
              position: item.position,
            })),
          },
        },
        select: { id: true, publicId: true },
      });

      await tx.invoiceRevision.create({
        data: {
          invoiceId: created.id,
          revisionNumber: 1,
          editor: session.user.name || session.user.email,
          summary: `Duplicated from invoice #${source.invoiceNumber}.`,
          payload: { before: null, sourceInvoiceId: source.id },
        },
      });

      return created.publicId;
    });

    if (result === null)
      return fail("That invoice is no longer in your workspace.");

    revalidate(result);
    return ok({ id: result });
  } catch (error) {
    return toActionError("duplicateInvoice", error, {
      unique: DUPLICATE_NUMBER,
    });
  }
}
