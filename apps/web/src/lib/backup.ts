import { type ExtendedPrismaClient, getPrisma } from "@billow/db";
import type { Prisma } from "@billow/db/client";
import { z } from "zod";
import { uploadEntryName } from "@/lib/backup-format";

// Deliberately no "server-only" import: the payload schema in this module
// (backupPayloadSchema / parseBackupPayload) is unit tested directly in
// backup.test.ts without a database, matching registration.ts's style. The
// db-touching exports (exportWorkspace, importWorkspace) are still only ever
// called from route handlers.

/**
 * Backup and restore for the user-owned domain data: profiles, bank
 * accounts, clients, invoices, their line items and revisions.
 *
 * Deliberately excluded, on purpose, because they are credentials or
 * infrastructure rather than the user's business data, and re-importing them
 * would either be meaningless (they're re-derived at sign-in) or dangerous
 * (they'd let a backup file forge identity or bypass auth):
 *   - users, sessions, accounts (BetterAuth identity/credentials)
 *   - API keys (bearer secrets scoped to one installation)
 *   - two-factor records (TOTP secrets/backup codes)
 *   - error logs (operational, not user data)
 *
 * A restore only ever adds rows to the *importing* account. It never trusts
 * the userId embedded in a file (there isn't one, by design — see below) and
 * never overwrites or deletes existing data.
 */

export const BACKUP_FORMAT_VERSION = 3;

/**
 * Versions this build can restore.
 *
 * Version 1 was a bare JSON file with no uploads. Those exports are still
 * valid backups of everything they ever contained, and refusing them would
 * strand anyone who took one before this change — so v1 is accepted and
 * simply restores no files.
 */
export const SUPPORTED_BACKUP_FORMAT_VERSIONS = [1, 2, 3] as const;

const isoDateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Expected an ISO 8601 date string.",
  });

const invoiceStatusSchema = z.enum([
  "DRAFT",
  "SENT",
  "APPROVED",
  "PAID",
  "TAX_RECEIPT",
  "TAX_RETURN",
  "DONE",
  "VOID",
]);

// Every exported row keeps its original integer id so the payload can encode
// relations (bank account -> profile, invoice -> profile/bank/client, line
// items/revisions -> invoice). Import remaps every one of these to a freshly
// created id; none of them are trusted as real primary keys on the way back
// in. Invoice.publicId is omitted for the same reason: a restored invoice gets
// a fresh public identity rather than retaining a URL from another install.
// userId is intentionally never part of the payload: ownership is always
// decided by the importing session, not by data in the file.

const userProfileSchema = z.object({
  id: z.number().int(),
  displayName: z.string().min(1),
  legalName: z.string().min(1),
  email: z.string(),
  taxId: z.string().nullable().optional(),
  address: z.string().min(1),
  department: z.string().nullable().optional(),
  manager: z.string().nullable().optional(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

const bankAccountSchema = z.object({
  id: z.number().int(),
  userProfileId: z.number().int(),
  label: z.string().min(1),
  bankName: z.string().min(1),
  bankAddress: z.string().nullable().optional(),
  bankPhone: z.string().nullable().optional(),
  accountHolderName: z.string().min(1),
  accountHolderAddress: z.string().nullable().optional(),
  accountNumber: z.string().min(1),
  accountType: z.string().nullable().optional(),
  institutionNumber: z.string().nullable().optional(),
  transitNumber: z.string().nullable().optional(),
  routingNumber: z.string().nullable().optional(),
  swift: z.string().nullable().optional(),
  iban: z.string().nullable().optional(),
  clabe: z.string().nullable().optional(),
  isDefault: z.boolean(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

const clientCompanySchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  legalName: z.string().nullable().optional(),
  address1: z.string().min(1),
  address2: z.string().nullable().optional(),
  cityStatePostal: z.string().min(1),
  country: z.string().min(1),
  email: z.string(),
  attentionTo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

const invoiceLineItemSchema = z.object({
  id: z.number().int(),
  description: z.string().min(1),
  note: z.string().nullable().optional(),
  quantity: z.number(),
  rate: z.number(),
  amount: z.number(),
  position: z.number().int(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

const invoiceRevisionSchema = z.object({
  id: z.number().int(),
  revisionNumber: z.number().int(),
  editor: z.string().min(1),
  summary: z.string().min(1),
  payload: z.unknown(),
  createdAt: isoDateString,
});

const invoiceDocumentSchema = z.object({
  uploadId: z.string().min(1),
  kind: z.enum([
    "CFDI_XML",
    "CFDI_PDF",
    "PAYMENT_PROOF",
    "SIGNED_COPY",
    "OTHER",
  ]),
  note: z.string().nullable().optional(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

const invoiceSchema = z.object({
  id: z.number().int(),
  invoiceNumber: z.number().int(),
  invoiceDate: isoDateString,
  status: invoiceStatusSchema,
  sentAt: isoDateString.nullable().optional(),
  approvedAt: isoDateString.nullable().optional(),
  paidAt: isoDateString.nullable().optional(),
  cfdiIssuedAt: isoDateString.nullable().optional(),
  currency: z.string().min(1),
  notes: z.string().nullable().optional(),
  userProfileId: z.number().int(),
  bankAccountId: z.number().int(),
  clientCompanyId: z.number().int(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
  lineItems: z.array(invoiceLineItemSchema),
  revisions: z.array(invoiceRevisionSchema),
  documents: z.array(invoiceDocumentSchema).default([]),
});

const taxPeriodDocumentSchema = z.object({
  uploadId: z.string().min(1),
  kind: z.enum(["TAX_RETURN", "PAYMENT_CONFIRMATION", "OTHER"]),
  note: z.string().nullable().optional(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

const taxPeriodSchema = z.object({
  id: z.number().int(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  currency: z.string().min(1),
  amountPaid: z.number().nullable().optional(),
  filedAt: isoDateString.nullable().optional(),
  paidAt: isoDateString.nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
  documents: z.array(taxPeriodDocumentSchema).default([]),
});

/**
 * An uploaded file's metadata. The bytes live in the archive alongside the
 * manifest, at the entry named by `archiveEntry`.
 *
 * `storageKey` is deliberately NOT exported: keys encode the owning user and
 * are regenerated on import, exactly as integer ids are remapped. That keeps a
 * restore from writing into another account's storage prefix even if the file
 * is hand-edited.
 *
 * `checksum` is carried so a restore can prove the bytes it extracted are the
 * bytes that were exported, rather than trusting the archive.
 */
const uploadSchema = z.object({
  id: z.string().min(1).optional(),
  archiveEntry: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().nonnegative(),
  checksum: z.string().min(1),
  kind: z.string().min(1),
  createdAt: isoDateString,
});

export const backupDataSchema = z.object({
  userProfiles: z.array(userProfileSchema),
  bankAccounts: z.array(bankAccountSchema),
  clientCompanies: z.array(clientCompanySchema),
  invoices: z.array(invoiceSchema),
  taxPeriods: z.array(taxPeriodSchema).default([]),
  // Absent in version 1 exports, which predate uploads being included.
  uploads: z.array(uploadSchema).default([]),
});

// formatVersion is checked against the supported set so an old or future
// export gets one clear rejection message rather than a pile of unrelated
// field errors from a shape mismatch.
export const backupPayloadSchema = z.object({
  formatVersion: z
    .number()
    .int()
    .refine(
      (value) =>
        (SUPPORTED_BACKUP_FORMAT_VERSIONS as readonly number[]).includes(value),
      `Unsupported backup format version. This build reads versions ${SUPPORTED_BACKUP_FORMAT_VERSIONS.join(" and ")}.`,
    ),
  exportedAt: isoDateString,
  data: backupDataSchema,
});

export type BackupPayload = z.infer<typeof backupPayloadSchema>;
export type BackupData = z.infer<typeof backupDataSchema>;

export type ImportSummary = {
  userProfiles: number;
  bankAccounts: number;
  clientCompanies: number;
  invoices: number;
  lineItems: number;
  revisions: number;
  invoiceDocuments: number;
  taxPeriods: number;
  taxPeriodDocuments: number;
  skippedBankAccounts: number;
  skippedInvoices: number;
  skippedTaxPeriods: number;
};

/**
 * Reads the signed-in user's domain data into a JSON-serialisable snapshot.
 *
 * The client is passed in rather than resolved here so this module keeps no
 * dependency on the auth stack — it is pure enough to unit-test, and importing
 * the session machinery to fetch a client would have made that impossible.
 *
 * Callers should pass the encrypted-aware client: a user-initiated export
 * decrypts by design — see "Backups leave the encryption boundary" in the
 * data-classification docs — and the plain client would write ciphertext that
 * nobody, including the user, can restore from. Protecting the *file* is a
 * separate, opt-in layer: `@billow/crypto`'s backup envelope seals this
 * payload under the account's recovery key on its way into the archive.
 */
export async function exportWorkspace(
  userId: string,
  client: Pick<
    ReturnType<typeof getPrisma>,
    | "userProfile"
    | "bankAccount"
    | "clientCompany"
    | "invoice"
    | "taxPeriod"
    | "upload"
  > = getPrisma(),
): Promise<BackupPayload> {
  const prisma = client;

  const [
    userProfiles,
    bankAccounts,
    clientCompanies,
    invoices,
    taxPeriods,
    uploads,
  ] = await Promise.all([
    prisma.userProfile.findMany({
      where: { userId },
      orderBy: { id: "asc" },
    }),
    prisma.bankAccount.findMany({
      where: { userProfile: { userId } },
      orderBy: { id: "asc" },
    }),
    prisma.clientCompany.findMany({
      where: { userId },
      orderBy: { id: "asc" },
    }),
    prisma.invoice.findMany({
      where: { userId },
      include: {
        lineItems: { orderBy: { position: "asc" } },
        revisions: { orderBy: { revisionNumber: "asc" } },
        documents: { orderBy: { kind: "asc" } },
      },
      orderBy: { id: "asc" },
    }),
    prisma.taxPeriod.findMany({
      where: { userId },
      include: { documents: { orderBy: { kind: "asc" } } },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    }),
    // Same ordering as exportUploadRecords, so the Nth manifest entry and
    // the Nth archive entry describe the same file.
    prisma.upload.findMany({ where: { userId }, orderBy: { id: "asc" } }),
  ]);

  const data: BackupData = {
    userProfiles: userProfiles.map((profile) => ({
      id: profile.id,
      displayName: profile.displayName,
      legalName: profile.legalName,
      email: profile.email,
      taxId: profile.taxId,
      address: profile.address,
      department: profile.department,
      manager: profile.manager,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    })),
    bankAccounts: bankAccounts.map((account) => ({
      id: account.id,
      userProfileId: account.userProfileId,
      label: account.label,
      bankName: account.bankName,
      bankAddress: account.bankAddress,
      bankPhone: account.bankPhone,
      accountHolderName: account.accountHolderName,
      accountHolderAddress: account.accountHolderAddress,
      accountNumber: account.accountNumber,
      accountType: account.accountType,
      institutionNumber: account.institutionNumber,
      transitNumber: account.transitNumber,
      routingNumber: account.routingNumber,
      swift: account.swift,
      iban: account.iban,
      clabe: account.clabe,
      isDefault: account.isDefault,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    })),
    clientCompanies: clientCompanies.map((client) => ({
      id: client.id,
      name: client.name,
      legalName: client.legalName,
      address1: client.address1,
      address2: client.address2,
      cityStatePostal: client.cityStatePostal,
      country: client.country,
      email: client.email,
      attentionTo: client.attentionTo,
      notes: client.notes,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
    })),
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate.toISOString(),
      status: invoice.status,
      sentAt: invoice.sentAt?.toISOString() ?? null,
      approvedAt: invoice.approvedAt?.toISOString() ?? null,
      paidAt: invoice.paidAt?.toISOString() ?? null,
      cfdiIssuedAt: invoice.cfdiIssuedAt?.toISOString() ?? null,
      currency: invoice.currency,
      notes: invoice.notes,
      userProfileId: invoice.userProfileId,
      bankAccountId: invoice.bankAccountId,
      clientCompanyId: invoice.clientCompanyId,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
      lineItems: invoice.lineItems.map((lineItem) => ({
        id: lineItem.id,
        description: lineItem.description,
        note: lineItem.note,
        quantity: Number(lineItem.quantity),
        rate: Number(lineItem.rate),
        amount: Number(lineItem.amount),
        position: lineItem.position,
        createdAt: lineItem.createdAt.toISOString(),
        updatedAt: lineItem.updatedAt.toISOString(),
      })),
      revisions: invoice.revisions.map((revision) => ({
        id: revision.id,
        revisionNumber: revision.revisionNumber,
        editor: revision.editor,
        summary: revision.summary,
        payload: revision.payload,
        createdAt: revision.createdAt.toISOString(),
      })),
      documents: invoice.documents.map((document) => ({
        uploadId: document.uploadId,
        kind: document.kind,
        note: document.note,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
      })),
    })),
    taxPeriods: taxPeriods.map((period) => ({
      id: period.id,
      year: period.year,
      month: period.month,
      currency: period.currency,
      amountPaid: period.amountPaid === null ? null : Number(period.amountPaid),
      filedAt: period.filedAt?.toISOString() ?? null,
      paidAt: period.paidAt?.toISOString() ?? null,
      notes: period.notes,
      createdAt: period.createdAt.toISOString(),
      updatedAt: period.updatedAt.toISOString(),
      documents: period.documents.map((document) => ({
        uploadId: document.uploadId,
        kind: document.kind,
        note: document.note,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
      })),
    })),
    uploads: uploads.map((upload, index) => ({
      id: upload.id,
      archiveEntry: uploadEntryName(index),
      filename: upload.filename,
      contentType: upload.contentType,
      size: upload.size,
      checksum: upload.checksum,
      kind: upload.kind,
      createdAt: upload.createdAt.toISOString(),
    })),
  };

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

/**
 * The upload rows backing an export, in the same order `exportWorkspace`
 * records them, so entry N in the archive is `data.uploads[N]`.
 *
 * Returned separately from the payload because the payload is JSON and these
 * carry `storageKey`, which is where the bytes are read from and is
 * deliberately never written into the file.
 */
export async function exportUploadRecords(userId: string) {
  return getPrisma().upload.findMany({
    where: { userId },
    orderBy: { id: "asc" },
    select: { storageKey: true, size: true, filename: true },
  });
}

/**
 * Validates an untrusted upload against `backupPayloadSchema`.
 * Returns either the parsed payload or the zod error for the caller to
 * report back with field-level detail.
 */
export function parseBackupPayload(payload: unknown) {
  return backupPayloadSchema.safeParse(payload);
}

/** Only the transaction entry point is needed to write a whole restore. */
type ImportClient = Pick<ExtendedPrismaClient, "$transaction">;

/**
 * The encrypted-aware client for the importing session.
 *
 * Imported lazily rather than at the top of the file so this module keeps no
 * load-time dependency on the auth stack and its schema half stays unit
 * testable — the same reason `server-only` is absent (see the note at the top).
 */
async function workspaceClient(): Promise<ImportClient> {
  const { getWorkspacePrisma } = await import("./workspace-prisma");
  const { prisma } = await getWorkspacePrisma();
  return prisma;
}

/**
 * Imports a validated payload into the given user's account. Every owned row
 * gets `userId` set to `userId` regardless of what (if anything) was in the
 * file, and every id is remapped: old integer ids only ever serve as keys
 * into an in-memory old-id -> new-id map built as rows are created, so
 * relations survive without colliding with (or trusting) ids already in the
 * database. Bank accounts or invoices that reference a profile/bank/client
 * missing from the payload are skipped rather than failing the whole import.
 *
 * Writes through the encrypted client, not `getPrisma()`. A restore recreates
 * every bank account a user owns in one transaction, so getting this wrong was
 * the largest single plaintext write in the app — and the most silent, because
 * the restored rows read back correctly either way.
 */
export async function importWorkspace(
  userId: string,
  data: BackupData,
  uploadIdMap: ReadonlyMap<string, string> = new Map(),
): Promise<ImportSummary> {
  const prisma = await workspaceClient();

  return prisma.$transaction(async (tx) => {
    const profileIdMap = new Map<number, number>();
    const bankAccountIdMap = new Map<number, number>();
    const clientCompanyIdMap = new Map<number, number>();

    let bankAccountCount = 0;
    let skippedBankAccounts = 0;
    let invoiceCount = 0;
    let skippedInvoices = 0;
    let lineItemCount = 0;
    let revisionCount = 0;
    let invoiceDocumentCount = 0;
    let taxPeriodCount = 0;
    let taxPeriodDocumentCount = 0;
    let skippedTaxPeriods = 0;

    for (const profile of data.userProfiles) {
      const created = await tx.userProfile.create({
        data: {
          userId,
          displayName: profile.displayName,
          legalName: profile.legalName,
          email: profile.email,
          taxId: profile.taxId ?? null,
          address: profile.address,
          department: profile.department ?? null,
          manager: profile.manager ?? null,
        },
      });
      profileIdMap.set(profile.id, created.id);
    }

    for (const account of data.bankAccounts) {
      const newProfileId = profileIdMap.get(account.userProfileId);
      if (newProfileId === undefined) {
        skippedBankAccounts += 1;
        continue;
      }

      const created = await tx.bankAccount.create({
        data: {
          userProfileId: newProfileId,
          label: account.label,
          bankName: account.bankName,
          bankAddress: account.bankAddress ?? null,
          bankPhone: account.bankPhone ?? null,
          accountHolderName: account.accountHolderName,
          accountHolderAddress: account.accountHolderAddress ?? null,
          accountNumber: account.accountNumber,
          accountType: account.accountType ?? null,
          institutionNumber: account.institutionNumber ?? null,
          transitNumber: account.transitNumber ?? null,
          routingNumber: account.routingNumber ?? null,
          swift: account.swift ?? null,
          iban: account.iban ?? null,
          clabe: account.clabe ?? null,
          isDefault: account.isDefault,
        },
      });
      bankAccountIdMap.set(account.id, created.id);
      bankAccountCount += 1;
    }

    for (const client of data.clientCompanies) {
      const created = await tx.clientCompany.create({
        data: {
          userId,
          name: client.name,
          legalName: client.legalName ?? null,
          address1: client.address1,
          address2: client.address2 ?? null,
          cityStatePostal: client.cityStatePostal,
          country: client.country,
          email: client.email,
          attentionTo: client.attentionTo ?? null,
          notes: client.notes ?? null,
        },
      });
      clientCompanyIdMap.set(client.id, created.id);
    }

    // Invoice numbers are unique per user, so a restored invoice that
    // collides with one already on the account is offset above the
    // account's current high-water mark rather than dropped.
    const currentMax = await tx.invoice.findFirst({
      where: { userId },
      orderBy: { invoiceNumber: "desc" },
      select: { invoiceNumber: true },
    });
    let nextInvoiceNumber = (currentMax?.invoiceNumber ?? 0) + 1;
    const usedInvoiceNumbers = new Set<number>();

    for (const invoice of data.invoices) {
      const newProfileId = profileIdMap.get(invoice.userProfileId);
      const newBankAccountId = bankAccountIdMap.get(invoice.bankAccountId);
      const newClientCompanyId = clientCompanyIdMap.get(
        invoice.clientCompanyId,
      );

      if (
        newProfileId === undefined ||
        newBankAccountId === undefined ||
        newClientCompanyId === undefined
      ) {
        skippedInvoices += 1;
        continue;
      }

      let invoiceNumber = invoice.invoiceNumber;
      const existing = await tx.invoice.findUnique({
        where: { userId_invoiceNumber: { userId, invoiceNumber } },
        select: { id: true },
      });
      if (existing || usedInvoiceNumbers.has(invoiceNumber)) {
        invoiceNumber = nextInvoiceNumber;
      }
      usedInvoiceNumbers.add(invoiceNumber);
      nextInvoiceNumber = Math.max(nextInvoiceNumber, invoiceNumber + 1);

      const createdInvoice = await tx.invoice.create({
        data: {
          userId,
          invoiceNumber,
          invoiceDate: new Date(invoice.invoiceDate),
          status: invoice.status,
          sentAt: invoice.sentAt ? new Date(invoice.sentAt) : null,
          approvedAt: invoice.approvedAt ? new Date(invoice.approvedAt) : null,
          paidAt: invoice.paidAt ? new Date(invoice.paidAt) : null,
          cfdiIssuedAt: invoice.cfdiIssuedAt
            ? new Date(invoice.cfdiIssuedAt)
            : null,
          currency: invoice.currency,
          notes: invoice.notes ?? null,
          userProfileId: newProfileId,
          bankAccountId: newBankAccountId,
          clientCompanyId: newClientCompanyId,
        },
      });
      invoiceCount += 1;

      for (const lineItem of invoice.lineItems) {
        await tx.invoiceLineItem.create({
          data: {
            invoiceId: createdInvoice.id,
            description: lineItem.description,
            note: lineItem.note ?? null,
            quantity: lineItem.quantity,
            rate: lineItem.rate,
            amount: lineItem.amount,
            position: lineItem.position,
          },
        });
        lineItemCount += 1;
      }

      for (const revision of invoice.revisions) {
        await tx.invoiceRevision.create({
          data: {
            invoiceId: createdInvoice.id,
            revisionNumber: revision.revisionNumber,
            editor: revision.editor,
            summary: revision.summary,
            payload: revision.payload as Prisma.InputJsonValue,
          },
        });
        revisionCount += 1;
      }

      for (const document of invoice.documents ?? []) {
        const uploadId = uploadIdMap.get(document.uploadId);
        if (!uploadId) continue;
        await tx.upload.update({
          where: { id: uploadId },
          data: { kind: "invoice_document" },
        });
        await tx.invoiceDocument.create({
          data: {
            invoiceId: createdInvoice.id,
            uploadId,
            kind: document.kind,
            note: document.note ?? null,
          },
        });
        invoiceDocumentCount += 1;
      }
    }

    for (const period of data.taxPeriods ?? []) {
      const existing = await tx.taxPeriod.findUnique({
        where: {
          userId_year_month: {
            userId,
            year: period.year,
            month: period.month,
          },
        },
        select: { id: true },
      });
      if (existing) {
        skippedTaxPeriods += 1;
        continue;
      }

      const createdPeriod = await tx.taxPeriod.create({
        data: {
          userId,
          year: period.year,
          month: period.month,
          currency: period.currency,
          amountPaid: period.amountPaid ?? null,
          filedAt: period.filedAt ? new Date(period.filedAt) : null,
          paidAt: period.paidAt ? new Date(period.paidAt) : null,
          notes: period.notes ?? null,
        },
      });
      taxPeriodCount += 1;

      for (const document of period.documents) {
        const uploadId = uploadIdMap.get(document.uploadId);
        if (!uploadId) continue;
        await tx.upload.update({
          where: { id: uploadId },
          data: { kind: "tax_period_document" },
        });
        await tx.taxPeriodDocument.create({
          data: {
            taxPeriodId: createdPeriod.id,
            uploadId,
            kind: document.kind,
            note: document.note ?? null,
          },
        });
        taxPeriodDocumentCount += 1;
      }
    }

    return {
      userProfiles: profileIdMap.size,
      bankAccounts: bankAccountCount,
      clientCompanies: clientCompanyIdMap.size,
      invoices: invoiceCount,
      lineItems: lineItemCount,
      revisions: revisionCount,
      invoiceDocuments: invoiceDocumentCount,
      taxPeriods: taxPeriodCount,
      taxPeriodDocuments: taxPeriodDocumentCount,
      skippedBankAccounts,
      skippedInvoices,
      skippedTaxPeriods,
    };
  });
}
