import "server-only";

import { toDateInputValue } from "@/lib/date-only";
import { recordError } from "@/lib/error-log";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

/**
 * Reads for the workspace CRUD screens that have not moved to lib/workspace/
 * yet. `ClientCompany` and `TaxPeriod` own their own reads there, beside their
 * writes; the rest still live here.
 *
 * Reads for the workspace CRUD screens.
 *
 * Everything here goes through `getWorkspacePrisma()` so the encrypted columns
 * on `UserProfile` and `BankAccount` come back readable. The `encrypted` flag
 * rides along on each result: when it is false this request could not reach a
 * data key, the sensitive fields are ciphertext, and the screen must say so
 * rather than print an envelope at the user.
 */

export async function listSenderProfiles(userId: string) {
  const { prisma, encrypted } = await getWorkspacePrisma();
  const profiles = await prisma.userProfile.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return { profiles, encrypted };
}

export async function listBankAccounts(userId: string) {
  const { prisma, encrypted } = await getWorkspacePrisma();
  const accounts = await prisma.bankAccount.findMany({
    where: { userProfile: { userId } },
    include: { userProfile: { select: { id: true, displayName: true } } },
    orderBy: [{ isDefault: "desc" }, { label: "asc" }],
  });

  return { accounts, encrypted };
}

/**
 * The invoice a form is about to edit, shaped as form values rather than as
 * database rows — `Decimal` and `Date` do not survive the trip to a client
 * component, and converting them at the boundary keeps that conversion in one
 * place instead of in every field.
 */
export async function getInvoiceForEdit(id: string, userId: string) {
  const { prisma } = await getWorkspacePrisma();

  const invoice = await prisma.invoice.findFirst({
    where: { publicId: id, userId },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  if (!invoice) return null;

  return {
    id: invoice.publicId,
    values: {
      userProfileId: invoice.userProfileId,
      bankAccountId: invoice.bankAccountId,
      clientCompanyId: invoice.clientCompanyId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: toDateInputValue(invoice.invoiceDate),
      currency: invoice.currency,
      status: invoice.status,
      notes: invoice.notes ?? "",
      lineItems: invoice.lineItems.map((item) => ({
        description: item.description,
        note: item.note ?? "",
        quantity: Number(item.quantity),
        rate: Number(item.rate),
      })),
    },
  };
}

/**
 * The records an invoice form has to choose between, plus the defaults a new
 * invoice starts with.
 *
 * `mostRecentClientId` implements "default to the most recently used client",
 * which for a contractor invoicing the same company every month is the right
 * guess often enough to be worth the extra query.
 */
export async function getInvoiceFormOptions(userId: string) {
  try {
    const { prisma, encrypted } = await getWorkspacePrisma();

    const [profiles, accounts, clients, highest, latestInvoice] =
      await Promise.all([
        prisma.userProfile.findMany({
          where: { userId },
          select: { id: true, displayName: true, legalName: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        prisma.bankAccount.findMany({
          where: { userProfile: { userId } },
          select: {
            id: true,
            label: true,
            bankName: true,
            isDefault: true,
            userProfileId: true,
          },
          orderBy: [{ isDefault: "desc" }, { label: "asc" }],
        }),
        prisma.clientCompany.findMany({
          where: { userId },
          select: { id: true, name: true },
          orderBy: [{ name: "asc" }],
        }),
        prisma.invoice.findFirst({
          where: { userId },
          orderBy: { invoiceNumber: "desc" },
          select: { invoiceNumber: true },
        }),
        prisma.invoice.findFirst({
          where: { userId },
          orderBy: [{ createdAt: "desc" }],
          select: { clientCompanyId: true, currency: true },
        }),
      ]);

    return {
      available: true as const,
      encrypted,
      profiles,
      accounts,
      clients,
      nextInvoiceNumber: (highest?.invoiceNumber ?? 0) + 1,
      mostRecentClientId: latestInvoice?.clientCompanyId ?? null,
      mostRecentCurrency: latestInvoice?.currency ?? null,
      ready: profiles.length > 0 && accounts.length > 0 && clients.length > 0,
    };
  } catch (error) {
    await recordError("getInvoiceFormOptions", error);
    return {
      available: false as const,
      encrypted: false,
      profiles: [],
      accounts: [],
      clients: [],
      nextInvoiceNumber: 1,
      mostRecentClientId: null,
      mostRecentCurrency: null,
      ready: false,
    };
  }
}

export type InvoiceFormOptions = Awaited<
  ReturnType<typeof getInvoiceFormOptions>
>;
