import Link from "next/link";
import { notFound } from "next/navigation";

import { InvoicePreview } from "@/app/(app)/invoices/_components/invoice-preview";
import { PrintButton } from "@/app/(app)/invoices/_components/print-button";
import { requireSession } from "@/lib/auth-session";
import { getInvoiceById } from "@/lib/invoice-workspace";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();

  const { id } = await params;
  const invoiceId = Number.parseInt(id, 10);

  if (Number.isNaN(invoiceId)) {
    notFound();
  }

  const invoice = await getInvoiceById(invoiceId);

  if (!invoice) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to dashboard
        </Link>
        <PrintButton />
      </div>
      <InvoicePreview invoice={invoice} />
    </div>
  );
}
