import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { error } from "@/lib/api/respond";
import { numericId, workspaceError } from "@/lib/api/workspace-route";
import { toTaxPeriodResponse } from "@/lib/schemas/tax-periods";
import {
  deleteTaxPeriod,
  getTaxPeriod,
  updateTaxPeriod,
} from "@/lib/workspace/tax-periods";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/tax-periods/[id]
 *
 * Scoped to the authenticated account: another account's id refuses with the
 * same `not_found` as a missing one, so this never confirms one exists.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const id = numericId((await params).id);
  if (id === null) return error("Invalid tax period id.", 400);

  const result = await getTaxPeriod(identity.userId, id);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json(toTaxPeriodResponse(result.data));
}

/**
 * PUT /api/v1/tax-periods/[id]
 *
 * A full replacement. Every nullable field is optional, and an absent one is
 * written as null — so omitting `paidAt` clears the payment date rather than
 * leaving it alone. Attached documents are untouched; they are not part of
 * this representation to write.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const identity = await requireApiIdentity(request, { mutating: true });
  if (identity instanceof NextResponse) return identity;

  const id = numericId((await params).id);
  if (id === null) return error("Invalid tax period id.", 400);

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return error("Send a JSON object describing the tax period.", 400);
  }

  const updated = await updateTaxPeriod(identity.userId, id, body);
  if (!updated.ok) return workspaceError(updated);

  return NextResponse.json(toTaxPeriodResponse(updated.data));
}

/**
 * DELETE /api/v1/tax-periods/[id]
 *
 * Refused with 409 while any document is attached. The database would cascade
 * them away — see the rule in lib/workspace/tax-periods.ts for why that is not
 * what should happen to a filed return.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const identity = await requireApiIdentity(request, { mutating: true });
  if (identity instanceof NextResponse) return identity;

  const id = numericId((await params).id);
  if (id === null) return error("Invalid tax period id.", 400);

  const result = await deleteTaxPeriod(identity.userId, id);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json({ ok: true });
}
