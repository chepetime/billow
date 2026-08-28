import "server-only";

import type { Prisma } from "@billow/db/client";

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
import {
  refuse,
  rule,
  succeed,
  type WorkspaceResult,
  type WorkspaceTx,
} from "@/lib/workspace/rule";

/**
 * Invoices.
 *
 * The entity that made a generic CRUD layer the wrong shape. Three things set
 * it apart from clients and tax periods:
 *
 * - It is addressed by `publicId`, an opaque UUID, not a serial id. Nothing
 *   here takes the integer primary key from outside.
 * - Every write is a transaction that also appends an `InvoiceRevision`. The
 *   history is the reason an edit is safe, and a write that skipped it would
 *   be indistinguishable afterwards from one that never happened.
 * - Three foreign keys must be confirmed to belong to the caller before they
 *   are written. Without that, an id posted straight at the API would attach
 *   another account's bank details to an invoice.
 */

/**
 * The detail read deliberately omits `userProfile` and `bankAccount`, which
 * `getInvoiceById` in lib/invoice-workspace.ts loads for the detail page.
 * Those are the two encrypted models: an API-key caller holds no data key, so
 * every sensitive column on them would come back null. Joining them here would
 * cost an AES-GCM decrypt per column to return nothing.
 */
const DETAIL_INCLUDE = {
  clientCompany: true,
  lineItems: { orderBy: { position: "asc" } },
  documents: { include: { upload: true }, orderBy: { kind: "asc" } },
} as const;

const LIST_INCLUDE = {
  clientCompany: { select: { id: true, name: true } },
} as const;

// userProfileId, bankAccountId and clientCompanyId are columns on Invoice, so
// they ride along on every row without a join — which is what makes a read
// sufficient to build the PUT that rewrites it.

export type InvoiceDetail = Prisma.InvoiceGetPayload<{
  include: typeof DETAIL_INCLUDE;
}> & { total: number };

/**
 * A list row carries its total, because an invoice has no total column — it is
 * the sum of its line items. Attaching it here rather than leaving each caller
 * to reduce keeps the page and the API from disagreeing about the number, and
 * lets the list query skip hydrating line items it would otherwise fetch only
 * to add up and throw away.
 */
export type InvoiceListRow = Prisma.InvoiceGetPayload<{
  include: typeof LIST_INCLUDE;
}> & { total: number };

/**
 * How many invoices a list request returns.
 *
 * A contractor billing monthly reaches this in eight years, and the count
 * beside it tells the truth when it is hit. The bound exists because an
 * unbounded list of invoices each hydrated with its line items is what the
 * dashboard had to be rescued from once already.
 */
export const INVOICE_PAGE_SIZE = 100;

/**
 * Who a revision records as the editor.
 *
 * A revision is an audit trail, so an edit made by a key left running in a
 * script must not be indistinguishable from one the account owner made by
 * hand. `via` comes from the same `ApiIdentity` the route already resolved.
 */
async function editorName(
  tx: WorkspaceTx,
  userId: string,
  via: "session" | "apiKey",
): Promise<string> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  const name = user?.name || user?.email || "Unknown";
  return via === "apiKey" ? `${name} (API key)` : name;
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

/**
 * Confirms all three references belong to `userId`.
 *
 * Runs inside the caller's transaction so the rows cannot be reassigned
 * between the check and the write.
 */
async function ownsReferences(
  tx: WorkspaceTx,
  userId: string,
  input: InvoiceInput,
): Promise<boolean> {
  const [profile, bankAccount, client] = await Promise.all([
    tx.userProfile.findFirst({
      where: { id: input.userProfileId, userId },
      select: { id: true },
    }),
    tx.bankAccount.findFirst({
      where: { id: input.bankAccountId, userProfile: { userId } },
      select: { id: true },
    }),
    tx.clientCompany.findFirst({
      where: { id: input.clientCompanyId, userId },
      select: { id: true },
    }),
  ]);
  return Boolean(profile && bankAccount && client);
}

export async function listInvoices(userId: string): Promise<
  WorkspaceResult<{
    invoices: InvoiceListRow[];
    count: number;
    truncated: boolean;
  }>
> {
  return rule("listInvoices", async ({ prisma }) => {
    const [rows, count, totals] = await Promise.all([
      prisma.invoice.findMany({
        where: { userId },
        include: LIST_INCLUDE,
        orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }],
        take: INVOICE_PAGE_SIZE,
      }),
      prisma.invoice.count({ where: { userId } }),
      // One grouped aggregate instead of hydrating every line item of every
      // invoice just to add up a number per row.
      prisma.invoiceLineItem.groupBy({
        by: ["invoiceId"],
        _sum: { amount: true },
        where: { invoice: { userId } },
      }),
    ]);

    const totalById = new Map(
      totals.map((row) => [row.invoiceId, Number(row._sum.amount ?? 0)]),
    );

    return succeed({
      invoices: rows.map((invoice) => ({
        ...invoice,
        total: totalById.get(invoice.id) ?? 0,
      })),
      count,
      truncated: count > rows.length,
    });
  });
}

export async function getInvoice(
  userId: string,
  publicId: string,
): Promise<WorkspaceResult<InvoiceDetail>> {
  if (!invoicePublicIdSchema.safeParse(publicId).success) {
    // A malformed id is not a missing row, but it must not be a distinct
    // answer either: telling the two apart would let a caller probe which
    // UUIDs exist. Both are `not_found`.
    return refuse("not_found");
  }

  return rule("getInvoice", async ({ prisma }) => {
    const invoice = await prisma.invoice.findFirst({
      where: { publicId, userId },
      include: DETAIL_INCLUDE,
    });
    if (invoice === null) return refuse("not_found");

    // The detail query already carries the line items, so the total is a
    // reduce rather than the grouped aggregate the list needs.
    return succeed({
      ...invoice,
      total: invoice.lineItems.reduce(
        (sum, item) => sum + Number(item.amount),
        0,
      ),
    });
  });
}

export async function createInvoice(
  userId: string,
  input: unknown,
  options: { via: "session" | "apiKey" },
): Promise<WorkspaceResult<InvoiceDetail>> {
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) {
    return refuse("invalid", parsed.error.flatten().fieldErrors);
  }

  const invoiceDate = parseDateOnly(parsed.data.invoiceDate);
  if (!invoiceDate) {
    return refuse("invalid", { invoiceDate: ["Enter a valid date."] });
  }

  const rows = toLineItemRows(parsed.data.lineItems);

  // A reused invoice number violates @@unique([userId, invoiceNumber]) and
  // comes back as `conflict`.
  const created = await rule("createInvoice", async ({ prisma }) =>
    prisma.$transaction(async (tx) => {
      if (!(await ownsReferences(tx, userId, parsed.data))) {
        return refuse("not_found");
      }

      const invoice = await tx.invoice.create({
        data: {
          userId,
          invoiceNumber: parsed.data.invoiceNumber,
          invoiceDate,
          currency: parsed.data.currency,
          status: "DRAFT",
          notes: parsed.data.notes,
          userProfileId: parsed.data.userProfileId,
          bankAccountId: parsed.data.bankAccountId,
          clientCompanyId: parsed.data.clientCompanyId,
          lineItems: { create: rows },
        },
        select: { id: true, publicId: true },
      });

      await tx.invoiceRevision.create({
        data: {
          invoiceId: invoice.id,
          revisionNumber: 1,
          editor: await editorName(tx, userId, options.via),
          summary: "Created invoice.",
          payload: {
            before: null,
            after: toSnapshot({ ...parsed.data, status: "DRAFT" }, rows),
          },
        },
      });

      return succeed(invoice.publicId);
    }),
  );

  return created.ok ? getInvoice(userId, created.data) : created;
}

export async function updateInvoice(
  userId: string,
  publicId: string,
  input: unknown,
  options: { via: "session" | "apiKey" },
): Promise<WorkspaceResult<InvoiceDetail>> {
  if (!invoicePublicIdSchema.safeParse(publicId).success) {
    return refuse("not_found");
  }

  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) {
    return refuse("invalid", parsed.error.flatten().fieldErrors);
  }

  const invoiceDate = parseDateOnly(parsed.data.invoiceDate);
  if (!invoiceDate) {
    return refuse("invalid", { invoiceDate: ["Enter a valid date."] });
  }

  const rows = toLineItemRows(parsed.data.lineItems);

  const updated = await rule("updateInvoice", async ({ prisma }) =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({
        where: { publicId, userId },
        include: {
          lineItems: { orderBy: { position: "asc" } },
          revisions: {
            orderBy: { revisionNumber: "desc" },
            take: 1,
            select: { revisionNumber: true },
          },
        },
      });
      if (!existing) return refuse("not_found");
      if (!(await ownsReferences(tx, userId, parsed.data))) {
        return refuse("not_found");
      }

      const before = toStoredInvoiceSnapshot(existing);
      // Status is not part of the editable payload — it is derived from the
      // workflow's milestones, so an edit carries the existing one forward.
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
          userProfileId: parsed.data.userProfileId,
          bankAccountId: parsed.data.bankAccountId,
          clientCompanyId: parsed.data.clientCompanyId,
          lineItems: { create: rows },
        },
      });

      await tx.invoiceRevision.create({
        data: {
          invoiceId: existing.id,
          revisionNumber: (existing.revisions[0]?.revisionNumber ?? 0) + 1,
          editor: await editorName(tx, userId, options.via),
          summary: summarizeInvoiceChanges(before, after),
          payload: { before, after },
        },
      });

      return succeed(true);
    }),
  );

  return updated.ok ? getInvoice(userId, publicId) : updated;
}

/**
 * Deletes an invoice and everything hanging off it.
 *
 * `lineItems` and `revisions` are `onDelete: Cascade`, so this takes the whole
 * edit history with it and there is no rule that can make that reversible —
 * unlike a client, which the database refuses to delete while it is referenced,
 * or a tax period, whose documents this layer protects. It is the reason
 * invoice writes waited for scoped keys: a read-only key cannot reach here.
 *
 * Attached CFDI uploads are deliberately left behind. `InvoiceDocument` rows
 * cascade, but the `Upload` they point at does not, so the bytes survive and
 * stay reachable at /api/v1/uploads?kind=invoice_document.
 */
export async function deleteInvoice(
  userId: string,
  publicId: string,
): Promise<WorkspaceResult> {
  if (!invoicePublicIdSchema.safeParse(publicId).success) {
    return refuse("not_found");
  }

  return rule("deleteInvoice", async ({ prisma }) => {
    const { count } = await prisma.invoice.deleteMany({
      where: { publicId, userId },
    });
    return count === 0 ? refuse("not_found") : succeed();
  });
}

/**
 * Copies an invoice into a new draft: same client, sender, bank and line
 * items, with the next number and this month's end date.
 *
 * The recurring monthly invoice is the case this app exists for, and retyping
 * six line items every month is the part of the old app worth deleting.
 */
export async function duplicateInvoice(
  userId: string,
  publicId: string,
  options: { via: "session" | "apiKey" },
): Promise<WorkspaceResult<InvoiceDetail>> {
  if (!invoicePublicIdSchema.safeParse(publicId).success) {
    return refuse("not_found");
  }

  const copied = await rule("duplicateInvoice", async ({ prisma }) =>
    prisma.$transaction(async (tx) => {
      const source = await tx.invoice.findFirst({
        where: { publicId, userId },
        include: { lineItems: { orderBy: { position: "asc" } } },
      });
      if (!source) return refuse("not_found");

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
          // Day 0 of next month is the last day of this one.
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
          editor: await editorName(tx, userId, options.via),
          summary: `Duplicated from invoice #${source.invoiceNumber}.`,
          payload: { before: null, after: null },
        },
      });

      return succeed(created.publicId);
    }),
  );

  return copied.ok ? getInvoice(userId, copied.data) : copied;
}
