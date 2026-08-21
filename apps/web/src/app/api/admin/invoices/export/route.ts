import { getAdminSession } from "@billow/auth";
import { getPrisma } from "@billow/db";
import { NextResponse } from "next/server";
import { error } from "@/lib/api/respond";
import { invoicesToCsv } from "@/lib/invoice-csv";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/invoices/export
 *
 * A CSV, one row per invoice — for pasting into a spreadsheet or accounting
 * tool, distinct from the full JSON/tar backup under /api/admin/backup.
 *
 * Reads through the plain client on purpose, not getWorkspacePrisma(): every
 * column here (invoice number, date, client name, currency, status, total)
 * lives on Invoice/ClientCompany, neither of which is in ENCRYPTED_FIELDS
 * (packages/db/src/field-encryption.ts). There is nothing to decrypt, so
 * unlike /api/admin/backup this has no data-key dependency to refuse on.
 */
export async function GET() {
  const { session, admin } = await getAdminSession();
  if (!session) return error("Authentication required.", 401);
  if (!admin) return error("Administrator access required.", 403);

  const invoices = await getPrisma().invoice.findMany({
    where: { userId: session.user.id },
    include: { clientCompany: true, lineItems: true },
    orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }],
  });

  const csv = invoicesToCsv(
    invoices.map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      clientName: invoice.clientCompany.name,
      currency: invoice.currency,
      status: invoice.status,
      total: invoice.lineItems.reduce(
        (sum, lineItem) => sum + Number(lineItem.amount),
        0,
      ),
    })),
  );

  const filename = `billow-invoices-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
