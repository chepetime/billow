import { requireSession } from "@billow/auth";
import { buttonVariants } from "@billow/shadcn/components/button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EncryptionNotice } from "@/app/(app)/_components/encryption-notice";
import { DuplicateButton } from "@/app/(app)/invoices/_components/duplicate-button";
import { InvoicePreview } from "@/app/(app)/invoices/_components/invoice-preview";
import {
  InvoiceWorkflowPanel,
  type WorkflowDocument,
} from "@/app/(app)/invoices/_components/invoice-workflow-panel";
import { PrintButton } from "@/app/(app)/invoices/_components/print-button";
import { toDateInputValue } from "@/lib/date-only";
import { formatCurrency, formatInvoiceDate } from "@/lib/format";
import { getInvoiceById, getTaxPeriodForMonth } from "@/lib/invoice-workspace";
import { invoicePublicIdSchema } from "@/lib/schemas/workspace";
import { cn } from "@/lib/utils";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();

  const { id } = await params;
  if (!invoicePublicIdSchema.safeParse(id).success) {
    notFound();
  }

  const invoice = await getInvoiceById(id, session.user.id);

  if (!invoice) {
    notFound();
  }

  const taxPeriod = await getTaxPeriodForMonth(
    session.user.id,
    invoice.invoiceDate,
  );
  const serializeDocument = (document: {
    kind: string;
    upload: {
      id: string;
      filename: string;
      contentType: string;
      size: number;
      createdAt: Date;
    };
  }): WorkflowDocument => ({
    kind: document.kind,
    upload: {
      id: document.upload.id,
      filename: document.upload.filename,
      contentType: document.upload.contentType,
      size: document.upload.size,
      createdAt: document.upload.createdAt.toISOString(),
    },
  });
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(invoice.invoiceDate);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-4 print:hidden">
        <Link
          href="/invoices"
          className="w-fit text-sm text-muted-foreground hover:text-foreground"
        >
          ← Invoices
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-normal">
              Invoice #{invoice.invoiceNumber}
            </h1>
            <p className="text-sm text-muted-foreground">
              {invoice.clientCompany.name} ·{" "}
              {formatInvoiceDate(invoice.invoiceDate)} ·{" "}
              {formatCurrency(invoice.total, invoice.currency)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/invoices/${invoice.id}/edit`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Edit invoice
            </Link>
            <DuplicateButton id={invoice.id} />
            <PrintButton />
          </div>
        </div>
      </div>
      <EncryptionNotice encrypted={invoice.encrypted} />
      <InvoiceWorkflowPanel
        invoice={{
          id: invoice.id,
          status: invoice.status,
          sentOn: invoice.sentAt ? toDateInputValue(invoice.sentAt) : null,
          approvedOn: invoice.approvedAt
            ? toDateInputValue(invoice.approvedAt)
            : null,
          paidOn: invoice.paidAt ? toDateInputValue(invoice.paidAt) : null,
          cfdiIssuedOn: invoice.cfdiIssuedAt
            ? toDateInputValue(invoice.cfdiIssuedAt)
            : null,
          documents: invoice.documents.map(serializeDocument),
        }}
        taxPeriod={{
          label: monthLabel,
          filedOn: taxPeriod?.filedAt
            ? toDateInputValue(taxPeriod.filedAt)
            : null,
          paidOn: taxPeriod?.paidAt ? toDateInputValue(taxPeriod.paidAt) : null,
          amountPaid:
            taxPeriod?.amountPaid === null ||
            taxPeriod?.amountPaid === undefined
              ? null
              : Number(taxPeriod.amountPaid),
          currency: taxPeriod?.currency ?? "MXN",
          documents: taxPeriod?.documents.map(serializeDocument) ?? [],
        }}
      />
      <InvoicePreview invoice={invoice} />
    </div>
  );
}
