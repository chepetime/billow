"use server";

import { requireSession } from "@billow/auth";
import { InvoiceDocumentKind, TaxPeriodDocumentKind } from "@billow/db/enums";
import { revalidatePath } from "next/cache";

import {
  type ActionResult,
  fail,
  ok,
  toActionError,
} from "@/lib/actions/result";
import { parseDateOnly, toDateInputValue } from "@/lib/date-only";
import { recordError } from "@/lib/error-log";
import { toStoredInvoiceSnapshot } from "@/lib/invoice-revision";
import { deriveInvoiceStatus } from "@/lib/invoice-status";
import {
  type InvoiceWorkflowCommand,
  invoiceWorkflowCommandSchema,
} from "@/lib/schemas/invoice-workflow";
import { deleteUpload } from "@/lib/uploads";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

const PDF_TYPES = new Set(["application/pdf"]);
const XML_TYPES = new Set(["application/xml", "text/xml"]);
const PAYMENT_CONFIRMATION_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

class WorkflowInputError extends Error {}

type InvoiceDocumentReplacement = {
  invoiceId: number;
  userId: string;
  uploadId: string | null | undefined;
  kind: InvoiceDocumentKind;
  acceptedTypes: ReadonlySet<string>;
};

type WorkspacePrisma = Awaited<ReturnType<typeof getWorkspacePrisma>>["prisma"];
type WorkflowTransactionClient = Parameters<
  Parameters<WorkspacePrisma["$transaction"]>[0]
>[0];

async function replaceInvoiceDocument(
  tx: WorkflowTransactionClient,
  replacement: InvoiceDocumentReplacement,
): Promise<string | null> {
  if (!replacement.uploadId) return null;

  const existing = await tx.invoiceDocument.findUnique({
    where: {
      invoiceId_kind: {
        invoiceId: replacement.invoiceId,
        kind: replacement.kind,
      },
    },
    select: { uploadId: true },
  });
  if (existing?.uploadId === replacement.uploadId) return null;

  const upload = await tx.upload.findFirst({
    where: { id: replacement.uploadId, userId: replacement.userId },
  });
  if (upload?.kind !== "attachment") {
    throw new WorkflowInputError("That file is no longer available.");
  }
  if (!replacement.acceptedTypes.has(upload.contentType)) {
    throw new WorkflowInputError("That file is not the expected type.");
  }

  await tx.invoiceDocument.deleteMany({
    where: { invoiceId: replacement.invoiceId, kind: replacement.kind },
  });
  await tx.upload.update({
    where: { id: upload.id },
    data: { kind: "invoice_document" },
  });
  await tx.invoiceDocument.create({
    data: {
      invoiceId: replacement.invoiceId,
      uploadId: upload.id,
      kind: replacement.kind,
    },
  });

  return existing?.uploadId ?? null;
}

type TaxDocumentReplacement = {
  taxPeriodId: number;
  userId: string;
  uploadId: string | null | undefined;
  kind: TaxPeriodDocumentKind;
  acceptedTypes: ReadonlySet<string>;
};

async function replaceTaxPeriodDocument(
  tx: WorkflowTransactionClient,
  replacement: TaxDocumentReplacement,
): Promise<string | null> {
  if (!replacement.uploadId) return null;

  const existing = await tx.taxPeriodDocument.findUnique({
    where: {
      taxPeriodId_kind: {
        taxPeriodId: replacement.taxPeriodId,
        kind: replacement.kind,
      },
    },
    select: { uploadId: true },
  });
  if (existing?.uploadId === replacement.uploadId) return null;

  const upload = await tx.upload.findFirst({
    where: { id: replacement.uploadId, userId: replacement.userId },
  });
  if (upload?.kind !== "attachment") {
    throw new WorkflowInputError("That file is no longer available.");
  }
  if (!replacement.acceptedTypes.has(upload.contentType)) {
    throw new WorkflowInputError("That file is not the expected type.");
  }

  await tx.taxPeriodDocument.deleteMany({
    where: {
      taxPeriodId: replacement.taxPeriodId,
      kind: replacement.kind,
    },
  });
  await tx.upload.update({
    where: { id: upload.id },
    data: { kind: "tax_period_document" },
  });
  await tx.taxPeriodDocument.create({
    data: {
      taxPeriodId: replacement.taxPeriodId,
      uploadId: upload.id,
      kind: replacement.kind,
    },
  });

  return existing?.uploadId ?? null;
}

function revalidate(invoiceId: string) {
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
}

export async function updateInvoiceWorkflow(
  command: InvoiceWorkflowCommand,
): Promise<ActionResult> {
  const parsed = invoiceWorkflowCommandSchema.safeParse(command);
  if (!parsed.success) return fail("Check the values and try again.");

  try {
    const session = await requireSession();
    const userId = session.user.id;
    const { prisma } = await getWorkspacePrisma();
    const uploadsToDelete = await prisma.$transaction(
      async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { publicId: parsed.data.invoiceId, userId },
          include: {
            lineItems: { orderBy: { position: "asc" } },
            documents: true,
            revisions: {
              orderBy: { revisionNumber: "desc" },
              take: 1,
              select: { revisionNumber: true },
            },
          },
        });
        if (!invoice)
          throw new WorkflowInputError("That invoice was not found.");

        const before = toStoredInvoiceSnapshot(invoice);
        const oldUploadIds: string[] = [];

        if (parsed.data.type === "tax-filing") {
          const filedAt = parseDateOnly(parsed.data.filedOn);
          if (!filedAt)
            throw new WorkflowInputError("Enter a valid filing date.");
          const period = await tx.taxPeriod.upsert({
            where: {
              userId_year_month: {
                userId,
                year: invoice.invoiceDate.getFullYear(),
                month: invoice.invoiceDate.getMonth() + 1,
              },
            },
            create: {
              userId,
              year: invoice.invoiceDate.getFullYear(),
              month: invoice.invoiceDate.getMonth() + 1,
              currency: "MXN",
              filedAt,
            },
            update: { filedAt },
          });
          const replaced = await replaceTaxPeriodDocument(tx, {
            taxPeriodId: period.id,
            userId,
            uploadId: parsed.data.returnUploadId,
            kind: TaxPeriodDocumentKind.TAX_RETURN,
            acceptedTypes: PDF_TYPES,
          });
          if (replaced) oldUploadIds.push(replaced);
          const taxReturn = await tx.taxPeriodDocument.findUnique({
            where: {
              taxPeriodId_kind: {
                taxPeriodId: period.id,
                kind: TaxPeriodDocumentKind.TAX_RETURN,
              },
            },
            select: { id: true },
          });
          if (!taxReturn) {
            throw new WorkflowInputError("Attach the filed tax return PDF.");
          }
          return oldUploadIds;
        }

        if (parsed.data.type === "tax-payment") {
          const paidAt = parseDateOnly(parsed.data.paidOn);
          if (!paidAt)
            throw new WorkflowInputError("Enter a valid payment date.");
          const period = await tx.taxPeriod.upsert({
            where: {
              userId_year_month: {
                userId,
                year: invoice.invoiceDate.getFullYear(),
                month: invoice.invoiceDate.getMonth() + 1,
              },
            },
            create: {
              userId,
              year: invoice.invoiceDate.getFullYear(),
              month: invoice.invoiceDate.getMonth() + 1,
              currency: parsed.data.currency,
              amountPaid: parsed.data.amountPaid,
              paidAt,
            },
            update: {
              currency: parsed.data.currency,
              amountPaid: parsed.data.amountPaid,
              paidAt,
            },
          });
          const replaced = await replaceTaxPeriodDocument(tx, {
            taxPeriodId: period.id,
            userId,
            uploadId: parsed.data.confirmationUploadId,
            kind: TaxPeriodDocumentKind.PAYMENT_CONFIRMATION,
            acceptedTypes: PAYMENT_CONFIRMATION_TYPES,
          });
          if (replaced) oldUploadIds.push(replaced);
          const confirmation = await tx.taxPeriodDocument.findUnique({
            where: {
              taxPeriodId_kind: {
                taxPeriodId: period.id,
                kind: TaxPeriodDocumentKind.PAYMENT_CONFIRMATION,
              },
            },
            select: { id: true },
          });
          if (!confirmation) {
            throw new WorkflowInputError("Attach the payment confirmation.");
          }
          return oldUploadIds;
        }

        let summary: string;
        let sentAt = invoice.sentAt;
        let approvedAt = invoice.approvedAt;
        let paidAt = invoice.paidAt;
        let cfdiIssuedAt = invoice.cfdiIssuedAt;
        let hasCfdiXml = invoice.documents.some(
          (document) => document.kind === InvoiceDocumentKind.CFDI_XML,
        );
        let hasCfdiPdf = invoice.documents.some(
          (document) => document.kind === InvoiceDocumentKind.CFDI_PDF,
        );

        if (parsed.data.type === "milestone") {
          const date = parsed.data.date
            ? parseDateOnly(parsed.data.date)
            : null;
          if (parsed.data.date && !date) {
            throw new WorkflowInputError("Enter a valid date.");
          }
          if (parsed.data.milestone === "sentAt") sentAt = date;
          if (parsed.data.milestone === "approvedAt") approvedAt = date;
          if (parsed.data.milestone === "paidAt") paidAt = date;
          const label =
            parsed.data.milestone === "sentAt"
              ? "sent"
              : parsed.data.milestone === "approvedAt"
                ? "approval"
                : "payment";
          summary = date
            ? `Recorded ${label} date as ${toDateInputValue(date)}.`
            : `Cleared ${label} date.`;
        } else if (parsed.data.type === "clear-cfdi") {
          oldUploadIds.push(
            ...invoice.documents
              .filter(
                (document) =>
                  document.kind === InvoiceDocumentKind.CFDI_XML ||
                  document.kind === InvoiceDocumentKind.CFDI_PDF,
              )
              .map((document) => document.uploadId),
          );
          await tx.invoiceDocument.deleteMany({
            where: {
              invoiceId: invoice.id,
              kind: {
                in: [
                  InvoiceDocumentKind.CFDI_XML,
                  InvoiceDocumentKind.CFDI_PDF,
                ],
              },
            },
          });
          cfdiIssuedAt = null;
          hasCfdiXml = false;
          hasCfdiPdf = false;
          summary = "Cleared fiscal invoice (CFDI).";
        } else {
          const issuedAt = parseDateOnly(parsed.data.issuedOn);
          if (!issuedAt) {
            throw new WorkflowInputError("Enter a valid CFDI issued date.");
          }
          cfdiIssuedAt = issuedAt;

          const oldXml = await replaceInvoiceDocument(tx, {
            invoiceId: invoice.id,
            userId,
            uploadId: parsed.data.xmlUploadId,
            kind: InvoiceDocumentKind.CFDI_XML,
            acceptedTypes: XML_TYPES,
          });
          const oldPdf = await replaceInvoiceDocument(tx, {
            invoiceId: invoice.id,
            userId,
            uploadId: parsed.data.pdfUploadId,
            kind: InvoiceDocumentKind.CFDI_PDF,
            acceptedTypes: PDF_TYPES,
          });
          if (oldXml) oldUploadIds.push(oldXml);
          if (oldPdf) oldUploadIds.push(oldPdf);
          hasCfdiXml = hasCfdiXml || Boolean(parsed.data.xmlUploadId);
          hasCfdiPdf = hasCfdiPdf || Boolean(parsed.data.pdfUploadId);
          if (!hasCfdiXml || !hasCfdiPdf) {
            throw new WorkflowInputError("Attach both the CFDI XML and PDF.");
          }
          summary = "Updated fiscal invoice (CFDI).";
        }

        const status = deriveInvoiceStatus({
          currentStatus: invoice.status,
          sentAt,
          approvedAt,
          paidAt,
          cfdiIssuedAt,
          hasCfdiXml,
          hasCfdiPdf,
        });
        const updated = await tx.invoice.update({
          where: { id: invoice.id },
          data: { status, sentAt, approvedAt, paidAt, cfdiIssuedAt },
          include: { lineItems: { orderBy: { position: "asc" } } },
        });
        const after = toStoredInvoiceSnapshot(updated);
        await tx.invoiceRevision.create({
          data: {
            invoiceId: invoice.id,
            revisionNumber: (invoice.revisions[0]?.revisionNumber ?? 0) + 1,
            editor: session.user.name || session.user.email,
            summary,
            payload: { before, after },
          },
        });

        return oldUploadIds;
      },
      // Every command reads all progress facts before deriving the cached
      // status. Serializable isolation prevents two simultaneous edits to
      // different dates from silently restoring one another's stale values.
      { isolationLevel: "Serializable" },
    );

    for (const uploadId of uploadsToDelete) {
      try {
        await deleteUpload(userId, uploadId);
      } catch (error) {
        await recordError("invoiceWorkflow.deleteReplacedUpload", error, {
          uploadId,
        });
      }
    }

    revalidate(parsed.data.invoiceId);
    return ok();
  } catch (error) {
    if (error instanceof WorkflowInputError) return fail(error.message);
    return toActionError("updateInvoiceWorkflow", error, {
      unique: "That file is already attached somewhere else.",
    });
  }
}
