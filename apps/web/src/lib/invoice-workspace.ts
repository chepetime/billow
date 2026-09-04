import "server-only";

import { type InvoiceStatus, Prisma } from "@billow/db/client";
import { recordError } from "@/lib/error-log";
import {
  CLOSED_INVOICE_STATUSES,
  invoiceAttentionLabel,
  PAID_INVOICE_STATUSES,
} from "@/lib/invoice-status";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

const CLOSED_STATUSES = new Set<InvoiceStatus>(CLOSED_INVOICE_STATUSES);
const PAID_STATUSES = new Set<InvoiceStatus>(PAID_INVOICE_STATUSES);

/**
 * How many invoices the workspace list carries. The dashboard is the only
 * consumer and renders exactly this many, so the query takes exactly this
 * many: before this bound the list was every invoice the user had ever
 * created, each hydrated with its line items and joins, on a 128 MB heap.
 */
export const RECENT_INVOICE_LIMIT = 8;

/**
 * The half-open instant range covering the calendar month containing `now`.
 *
 * The totals moved from JS to SQL, and the old filter compared
 * `invoiceDate.getMonth()`/`getFullYear()` — server-local values. A local-time
 * range boundary is the only translation that keeps the same invoices in the
 * bucket; a UTC-based one would shift the month edge for any server not on UTC.
 */
export function currentMonthRange(now: Date) {
  return {
    gte: new Date(now.getFullYear(), now.getMonth(), 1),
    // Month 12 rolls into January of the next year, so December needs no case.
    lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

/**
 * Postgres returns `SUM(numeric)` as a Decimal, and null when the filter
 * matched no rows at all. Summing in the database also drops the float drift
 * the old per-row `Number(amount)` accumulation carried: money stays exact
 * through the sum and is converted once, at the end.
 */
export type CurrencyTotal = { currency: string; amount: number };

type DashboardTotalInvoice = {
  id: number;
  currency: string;
  invoiceDate: Date;
  status: InvoiceStatus;
};

/**
 * Folds line-item totals into the currency of the invoice that owns them.
 *
 * `Invoice.currency` and `InvoiceLineItem.amount` live on separate tables,
 * so Prisma cannot group them together. We keep line items grouped in SQL,
 * then fold the one total per invoice here. Decimal arithmetic remains exact
 * until the values cross the server-to-UI boundary.
 */
function totalsByCurrency(
  invoices: DashboardTotalInvoice[],
  totalByInvoiceId: Map<number, Prisma.Decimal>,
): CurrencyTotal[] {
  const totals = new Map<string, Prisma.Decimal>();

  for (const invoice of invoices) {
    const current = totals.get(invoice.currency) ?? new Prisma.Decimal(0);
    totals.set(
      invoice.currency,
      current.add(totalByInvoiceId.get(invoice.id) ?? 0),
    );
  }

  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount: amount.toNumber() }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export type WorkspaceInvoice = Awaited<
  ReturnType<typeof getInvoiceWorkspace>
>["recentInvoices"][number];

export async function getInvoiceById(id: string, userId: string) {
  try {
    // Encrypted-aware, like getInvoiceWorkspace below: userProfile and
    // bankAccount come back readable when this request can reach the data
    // key, and as ciphertext (with `encrypted: false`) when it cannot.
    const { prisma, encrypted } = await getWorkspacePrisma();
    const invoice = await prisma.invoice.findFirst({
      where: { publicId: id, userId },
      include: {
        userProfile: true,
        bankAccount: true,
        clientCompany: true,
        lineItems: { orderBy: { position: "asc" } },
        revisions: { orderBy: { revisionNumber: "desc" } },
        documents: {
          include: { upload: true },
          orderBy: { kind: "asc" },
        },
      },
    });

    if (!invoice) {
      return null;
    }

    const total = invoice.lineItems.reduce((sum, lineItem) => {
      return sum + Number(lineItem.amount);
    }, 0);

    const { id: _internalId, publicId, ...fields } = invoice;
    return { ...fields, id: publicId, total, encrypted };
  } catch (error) {
    console.error("Failed to load invoice", error);
    return null;
  }
}

export async function getTaxPeriodForMonth(userId: string, date: Date) {
  try {
    const { prisma } = await getWorkspacePrisma();
    return prisma.taxPeriod.findUnique({
      where: {
        userId_year_month: {
          userId,
          year: date.getFullYear(),
          month: date.getMonth() + 1,
        },
      },
      include: {
        documents: {
          include: { upload: true },
          orderBy: { kind: "asc" },
        },
      },
    });
  } catch (error) {
    console.error("Failed to load monthly tax filing", error);
    return null;
  }
}

export async function getInvoiceWorkspace(userId: string, now = new Date()) {
  try {
    // Encrypted-aware: bank and profile fields come back readable when this
    // request can reach the data key, and as ciphertext when it cannot.
    const { prisma } = await getWorkspacePrisma();
    const month = currentMonthRange(now);

    const [
      metadata,
      userProfiles,
      bankAccounts,
      clientCompanies,
      recentInvoices,
      invoiceCount,
      nextInvoice,
      totalInvoices,
      lineTotals,
      attentionInvoices,
      currentTaxPeriod,
      currentMonthInvoice,
    ] = await Promise.all([
      prisma.appMetadata.findUnique({ where: { appId: "billow" } }),
      prisma.userProfile.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
      prisma.bankAccount.findMany({
        where: { userProfile: { userId } },
        include: { userProfile: true },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      }),
      prisma.clientCompany.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      }),
      prisma.invoice.findMany({
        where: { userId },
        // Only what the list actually renders. `bankAccount`, `userProfile`
        // and `revisions` were joined here but read by nobody — and the first
        // two are the encrypted models, so each joined row cost an AES-GCM
        // decrypt per encrypted column for a value that was thrown away.
        // `getInvoiceById` still loads the full graph for the detail page.
        include: {
          clientCompany: true,
          lineItems: { orderBy: { position: "asc" } },
        },
        orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }],
        take: RECENT_INVOICE_LIMIT,
      }),
      prisma.invoice.count({ where: { userId } }),
      prisma.invoice.findFirst({
        where: { userId },
        orderBy: { invoiceNumber: "desc" },
        select: { invoiceNumber: true },
      }),
      // Stat tiles cover every invoice, not only the bounded recent list.
      // The invoice supplies the currency and the line-item query supplies one
      // exact Decimal subtotal per invoice; summing face values across their
      // different currencies would be invalid.
      prisma.invoice.findMany({
        where: { userId },
        select: { id: true, currency: true, invoiceDate: true, status: true },
      }),
      prisma.invoiceLineItem.groupBy({
        by: ["invoiceId"],
        _sum: { amount: true },
        where: { invoice: { userId } },
      }),
      prisma.invoice.findMany({
        where: {
          userId,
          status: { not: "VOID" },
          // Status is only a cached summary. Query the underlying facts so a
          // restored or legacy DONE row with no CFDI files cannot disappear
          // from the attention list forever.
          OR: [
            { sentAt: null },
            { approvedAt: null },
            { paidAt: null },
            { cfdiIssuedAt: null },
            { documents: { none: { kind: "CFDI_XML" } } },
            { documents: { none: { kind: "CFDI_PDF" } } },
          ],
        },
        include: {
          clientCompany: { select: { name: true } },
          documents: { select: { kind: true } },
        },
        orderBy: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }],
        take: 8,
      }),
      prisma.taxPeriod.findUnique({
        where: {
          userId_year_month: {
            userId,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
          },
        },
        include: { documents: { select: { kind: true } } },
      }),
      prisma.invoice.findFirst({
        where: { userId, invoiceDate: month },
        orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }],
        select: { publicId: true },
      }),
    ]);

    // Per-invoice totals are still summed here rather than in SQL: these are
    // the few rows already in memory for display, and the row's own subtotal
    // is what the list prints.
    const invoicesWithTotals = recentInvoices.map((invoice) => {
      const total = invoice.lineItems.reduce((sum, lineItem) => {
        return sum + Number(lineItem.amount);
      }, 0);

      const { id: _internalId, publicId, ...fields } = invoice;
      return { ...fields, id: publicId, total };
    });

    const totalByInvoiceId = new Map(
      lineTotals.map((row) => [
        row.invoiceId,
        row._sum.amount ?? new Prisma.Decimal(0),
      ]),
    );
    const isCurrentMonth = (invoice: DashboardTotalInvoice) =>
      invoice.invoiceDate >= month.gte && invoice.invoiceDate < month.lt;
    const stats = {
      invoiceCount,
      currentTotals: totalsByCurrency(
        totalInvoices.filter(isCurrentMonth),
        totalByInvoiceId,
      ),
      openTotals: totalsByCurrency(
        totalInvoices.filter((invoice) => !CLOSED_STATUSES.has(invoice.status)),
        totalByInvoiceId,
      ),
      paidTotals: totalsByCurrency(
        totalInvoices.filter((invoice) => PAID_STATUSES.has(invoice.status)),
        totalByInvoiceId,
      ),
    };

    const attention = attentionInvoices.flatMap((invoice) => {
      const label = invoiceAttentionLabel({
        currentStatus: invoice.status,
        sentAt: invoice.sentAt,
        approvedAt: invoice.approvedAt,
        paidAt: invoice.paidAt,
        cfdiIssuedAt: invoice.cfdiIssuedAt,
        hasCfdiXml: invoice.documents.some(
          (document) => document.kind === "CFDI_XML",
        ),
        hasCfdiPdf: invoice.documents.some(
          (document) => document.kind === "CFDI_PDF",
        ),
      });
      return label
        ? [
            {
              key: `invoice-${invoice.publicId}`,
              href: `/invoices/${invoice.publicId}`,
              title: label,
              detail: `Invoice #${invoice.invoiceNumber} · ${invoice.clientCompany.name}`,
            },
          ]
        : [];
    });

    if (currentMonthInvoice) {
      const monthLabel = new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
      }).format(now);
      const hasReturn = currentTaxPeriod?.documents.some(
        (document) => document.kind === "TAX_RETURN",
      );
      const hasConfirmation = currentTaxPeriod?.documents.some(
        (document) => document.kind === "PAYMENT_CONFIRMATION",
      );
      if (!currentTaxPeriod?.filedAt || !hasReturn) {
        attention.push({
          key: `tax-${now.getFullYear()}-${now.getMonth() + 1}-filing`,
          href: `/invoices/${currentMonthInvoice.publicId}`,
          title: `Complete the ${monthLabel} monthly tax filing`,
          detail: "Add the filing date and tax return PDF.",
        });
      } else if (
        !currentTaxPeriod.paidAt ||
        currentTaxPeriod.amountPaid === null ||
        !hasConfirmation
      ) {
        attention.push({
          key: `tax-${now.getFullYear()}-${now.getMonth() + 1}-payment`,
          href: `/invoices/${currentMonthInvoice.publicId}`,
          title: `Complete the ${monthLabel} tax payment`,
          detail: "Add the amount, payment date, and confirmation.",
        });
      }
    }

    return {
      databaseAvailable: true,
      metadata,
      userProfiles,
      bankAccounts,
      clientCompanies,
      // Named for the bound it carries. It used to be called `invoices`, and
      // the derived `currentInvoices`/`openInvoices`/`paidInvoices` slices are
      // gone with it: reducing a truncated list is exactly the mistake this
      // change exists to prevent, so the shape no longer offers the option.
      recentInvoices: invoicesWithTotals,
      attention,
      hasWorkspace:
        userProfiles.length > 0 &&
        bankAccounts.length > 0 &&
        clientCompanies.length > 0,
      nextInvoiceNumber: (nextInvoice?.invoiceNumber ?? 0) + 1,
      stats,
      error: null as string | null,
    };
  } catch (error) {
    console.error("Failed to load invoice workspace", error);
    await recordError("getInvoiceWorkspace", error);
    return {
      databaseAvailable: false,
      metadata: null,
      userProfiles: [],
      bankAccounts: [],
      clientCompanies: [],
      recentInvoices: [],
      attention: [],
      hasWorkspace: false,
      nextInvoiceNumber: 1,
      stats: {
        invoiceCount: 0,
        currentTotals: [],
        openTotals: [],
        paidTotals: [],
      },
      error: "Billow could not reach the database yet.",
    };
  }
}
