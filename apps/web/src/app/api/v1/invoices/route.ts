import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { error } from "@/lib/api/respond";
import { workspaceError } from "@/lib/api/workspace-route";
import {
  toInvoiceDetailResponse,
  toInvoiceSummaryResponse,
} from "@/lib/schemas/invoices";
import { createInvoice, listInvoices } from "@/lib/workspace/invoices";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/invoices
 *
 * The account's invoices, newest first, bounded — `count` and `truncated` say
 * whether anything was left out rather than making the caller guess from the
 * array's length.
 */
export async function GET(request: Request) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const result = await listInvoices(identity.userId);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json({
    invoices: result.data.invoices.map(toInvoiceSummaryResponse),
    count: result.data.count,
    truncated: result.data.truncated,
  });
}

/**
 * POST /api/v1/invoices
 *
 * Creates a draft invoice with its line items. Needs a read-and-write key.
 *
 * The sender profile, bank account and client are confirmed to belong to the
 * caller inside the same transaction that writes the row: without that, an id
 * posted straight at this route would attach another account's bank details to
 * an invoice. A reference that is not yours is reported as `not_found`, the
 * same as an invoice that does not exist, so this never confirms which other
 * accounts' records exist.
 */
export async function POST(request: Request) {
  const identity = await requireApiIdentity(request, { mutating: true });
  if (identity instanceof NextResponse) return identity;

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return error("Send a JSON object describing the invoice.", 400);
  }

  const created = await createInvoice(identity.userId, body, {
    via: identity.via,
  });
  if (!created.ok) return workspaceError(created);

  return NextResponse.json(toInvoiceDetailResponse(created.data), {
    status: 201,
    headers: { Location: `/api/v1/invoices/${created.data.publicId}` },
  });
}
