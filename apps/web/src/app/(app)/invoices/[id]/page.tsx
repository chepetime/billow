import { requireSession } from "@billow/auth";
import { buttonVariants } from "@billow/shadcn/components/button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DuplicateButton } from "@/app/(app)/invoices/_components/duplicate-button";
import { InvoicePreview } from "@/app/(app)/invoices/_components/invoice-preview";
import { PrintButton } from "@/app/(app)/invoices/_components/print-button";
import { getInvoiceById } from "@/lib/invoice-workspace";
import { cn } from "@/lib/utils";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();

  const { id } = await params;
  const invoiceId = Number.parseInt(id, 10);

  if (Number.isNaN(invoiceId)) {
    notFound();
  }

  const invoice = await getInvoiceById(invoiceId, session.user.id);

  if (!invoice) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Link
          href="/invoices"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Invoices
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/invoices/${invoice.id}/edit`}
            className={cn(buttonVariants())}
          >
            Edit
          </Link>
          <DuplicateButton id={invoice.id} />
          <PrintButton />
        </div>
      </div>
      <InvoicePreview invoice={invoice} />
    </div>
  );
}
