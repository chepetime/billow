import { getSession, requireSession } from "@billow/auth";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { InvoiceForm } from "@/app/(app)/invoices/_components/invoice-form";
import type { InvoiceFormValues } from "@/lib/schemas/workspace";
import { invoicePublicIdSchema } from "@/lib/schemas/workspace";
import {
  getInvoiceForEdit,
  getInvoiceFormOptions,
} from "@/lib/workspace-records";

export const dynamic = "force-dynamic";

/** Shared by `generateMetadata` and the page, so the lookup happens once. */
const loadInvoice = cache(getInvoiceForEdit);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await getSession();
  const { id } = await params;
  if (!session || !invoicePublicIdSchema.safeParse(id).success) {
    return { title: "Edit invoice" };
  }

  const invoice = await loadInvoice(id, session.user.id);
  return {
    title: invoice
      ? `Edit invoice #${invoice.values.invoiceNumber}`
      : "Edit invoice",
  };
}

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (!invoicePublicIdSchema.safeParse(id).success) notFound();

  const [invoice, options] = await Promise.all([
    loadInvoice(id, session.user.id),
    getInvoiceFormOptions(session.user.id),
  ]);

  if (!invoice) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href={`/invoices/${invoice.id}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Invoice #{invoice.values.invoiceNumber}
      </Link>
      <h1 className="text-2xl font-semibold tracking-normal">Edit invoice</h1>

      {/*
        `currency` and `status` are plain strings on the row but unions in the
        form contract. The form itself handles a stored currency that is no
        longer in the picker, so this cast widens the type without hiding a
        value.
      */}
      <InvoiceForm
        id={invoice.id}
        options={options}
        defaultValues={invoice.values as InvoiceFormValues}
      />
    </div>
  );
}
