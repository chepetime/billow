import "server-only";

import { recordError } from "@/lib/error-log";
import { getPrisma } from "@billow/db";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "MXN",
  currencyDisplay: "code",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export type WorkspaceInvoice = Awaited<
  ReturnType<typeof getInvoiceWorkspace>
>["invoices"][number];

export function formatMoney(value: number) {
  return currencyFormatter.format(value);
}

export function formatInvoiceDate(value: Date) {
  return dateFormatter.format(value);
}

export function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(value);
}

export async function getInvoiceById(id: number) {
  try {
    const prisma = getPrisma();
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        userProfile: true,
        bankAccount: true,
        clientCompany: true,
        lineItems: { orderBy: { position: "asc" } },
        revisions: { orderBy: { revisionNumber: "desc" } },
      },
    });

    if (!invoice) {
      return null;
    }

    const total = invoice.lineItems.reduce((sum, lineItem) => {
      return sum + Number(lineItem.amount);
    }, 0);

    return { ...invoice, total };
  } catch (error) {
    console.error("Failed to load invoice", error);
    return null;
  }
}

export async function getInvoiceWorkspace() {
  try {
    const prisma = getPrisma();
    const [
      metadata,
      userProfiles,
      bankAccounts,
      clientCompanies,
      invoices,
      invoiceCount,
      nextInvoice,
    ] = await Promise.all([
      prisma.appMetadata.findUnique({ where: { appId: "sparkles-billow" } }),
      prisma.userProfile.findMany({
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
      prisma.bankAccount.findMany({
        include: { userProfile: true },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      }),
      prisma.clientCompany.findMany({
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      }),
      prisma.invoice.findMany({
        include: {
          bankAccount: true,
          clientCompany: true,
          lineItems: { orderBy: { position: "asc" } },
          userProfile: true,
          revisions: { orderBy: { revisionNumber: "desc" }, take: 3 },
        },
        orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }],
      }),
      prisma.invoice.count(),
      prisma.invoice.findFirst({
        orderBy: { invoiceNumber: "desc" },
        select: { invoiceNumber: true },
      }),
    ]);

    const invoicesWithTotals = invoices.map((invoice) => {
      const total = invoice.lineItems.reduce((sum, lineItem) => {
        return sum + Number(lineItem.amount);
      }, 0);

      return { ...invoice, total };
    });

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const currentInvoices = invoicesWithTotals.filter((invoice) => {
      return (
        invoice.invoiceDate.getMonth() === currentMonth &&
        invoice.invoiceDate.getFullYear() === currentYear
      );
    });
    const openInvoices = invoicesWithTotals.filter(
      (invoice) => invoice.status !== "PAID" && invoice.status !== "VOID",
    );
    const paidInvoices = invoicesWithTotals.filter(
      (invoice) => invoice.status === "PAID",
    );

    return {
      databaseAvailable: true,
      metadata,
      userProfiles,
      bankAccounts,
      clientCompanies,
      invoices: invoicesWithTotals,
      currentInvoices,
      openInvoices,
      paidInvoices,
      hasWorkspace:
        userProfiles.length > 0 &&
        bankAccounts.length > 0 &&
        clientCompanies.length > 0,
      nextInvoiceNumber: (nextInvoice?.invoiceNumber ?? 0) + 1,
      stats: {
        invoiceCount,
        currentTotal: currentInvoices.reduce(
          (sum, invoice) => sum + invoice.total,
          0,
        ),
        openTotal: openInvoices.reduce((sum, invoice) => sum + invoice.total, 0),
        paidTotal: paidInvoices.reduce((sum, invoice) => sum + invoice.total, 0),
      },
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
      invoices: [],
      currentInvoices: [],
      openInvoices: [],
      paidInvoices: [],
      hasWorkspace: false,
      nextInvoiceNumber: 1,
      stats: {
        invoiceCount: 0,
        currentTotal: 0,
        openTotal: 0,
        paidTotal: 0,
      },
      error: "Billow could not reach the database yet.",
    };
  }
}
