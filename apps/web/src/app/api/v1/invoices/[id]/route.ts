import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { error } from "@/lib/api/respond";
import { workspaceError } from "@/lib/api/workspace-route";
import { toInvoiceDetailResponse } from "@/lib/schemas/invoices";
import {
  deleteInvoice,
  getInvoice,
  updateInvoice,
} from "@/lib/workspace/invoices";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Invoices are addressed by `publicId`, an opaque UUID — not the serial id the
 * other entities use, so `numericId` does not apply here. The rules validate
 * the shape themselves and report a malformed id as `not_found`, because
 * answering differently would let a caller probe which UUIDs exist.
 */

/**
 * GET /api/v1/invoices/[id]
 *
 * One invoice with its line items and attached documents. Each document names
 * the upload holding its bytes, fetchable from /api/v1/uploads/{id}.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const result = await getInvoice(identity.userId, (await params).id);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json(toInvoiceDetailResponse(result.data));
}

/**
 * PUT /api/v1/invoices/[id]
 *
 * A full replacement of the editable fields, appending a revision. `status`
 * and the four progress dates are not editable here — they are derived from
 * the workflow's milestones and carried forward unchanged.
 *
 * Line items are replaced rather than reconciled: they have no identity a
 * caller would recognise across a save, and the revision payload preserves the
 * old set.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const identity = await requireApiIdentity(request, { mutating: true });
  if (identity instanceof NextResponse) return identity;

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return error("Send a JSON object describing the invoice.", 400);
  }

  const result = await updateInvoice(identity.userId, (await params).id, body, {
    via: identity.via,
  });
  if (!result.ok) return workspaceError(result);

  return NextResponse.json(toInvoiceDetailResponse(result.data));
}

/**
 * DELETE /api/v1/invoices/[id]
 *
 * Takes the line items and the whole revision history with it — both are
 * `onDelete: Cascade`, and no rule can make that reversible. This is the verb
 * that scoped keys existed for: a read-only key cannot reach it.
 *
 * Attached CFDI uploads survive; only the `InvoiceDocument` links cascade, so
 * the bytes stay at /api/v1/uploads?kind=invoice_document.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const identity = await requireApiIdentity(request, { mutating: true });
  if (identity instanceof NextResponse) return identity;

  const result = await deleteInvoice(identity.userId, (await params).id);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json({ ok: true });
}
