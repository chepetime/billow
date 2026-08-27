import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { error } from "@/lib/api/respond";
import { workspaceError } from "@/lib/api/workspace-response";
import { toTaxPeriodResponse } from "@/lib/schemas/tax-periods";
import {
  deleteTaxPeriod,
  getTaxPeriod,
  updateTaxPeriod,
} from "@/lib/workspace/tax-periods";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/** Serial integers, so a non-numeric id is malformed rather than missing. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

/**
 * Credentials, then the origin check for cookie callers on a mutation. A
 * request carrying its own API key is not a form submission a hostile page
 * could forge with the victim's cookies, so it skips the guard.
 */
async function identityFor(request: Request, mutating: boolean) {
  const identity = await requireApiIdentity(request.headers);
  if (identity instanceof NextResponse) return identity;

  if (mutating && identity.via === "session" && !isSameOriginRequest(request)) {
    return error("Invalid request origin.", 403);
  }

  return identity;
}

/**
 * GET /api/v1/tax-periods/[id]
 *
 * Scoped to the authenticated account: another account's id refuses with the
 * same `not_found` as a missing one, so this never confirms one exists.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const identity = await identityFor(request, false);
  if (identity instanceof NextResponse) return identity;

  const id = parseId((await params).id);
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
  const identity = await identityFor(request, true);
  if (identity instanceof NextResponse) return identity;

  const id = parseId((await params).id);
  if (id === null) return error("Invalid tax period id.", 400);

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return error("Send a JSON object describing the tax period.", 400);
  }

  const updated = await updateTaxPeriod(identity.userId, id, body);
  if (!updated.ok) return workspaceError(updated);

  const period = await getTaxPeriod(identity.userId, id);
  if (!period.ok) return workspaceError(period);

  return NextResponse.json(toTaxPeriodResponse(period.data));
}

/**
 * DELETE /api/v1/tax-periods/[id]
 *
 * Refused with 409 while any document is attached. The database would cascade
 * them away — see the rule in lib/workspace/tax-periods.ts for why that is not
 * what should happen to a filed return.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const identity = await identityFor(request, true);
  if (identity instanceof NextResponse) return identity;

  const id = parseId((await params).id);
  if (id === null) return error("Invalid tax period id.", 400);

  const result = await deleteTaxPeriod(identity.userId, id);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json({ ok: true });
}
