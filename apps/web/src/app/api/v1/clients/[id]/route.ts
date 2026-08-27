import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { error } from "@/lib/api/respond";
import { numericId, workspaceError } from "@/lib/api/workspace-route";
import { toClientResponse } from "@/lib/schemas/clients";
import {
  deleteClientCompany,
  getClientCompany,
  updateClientCompany,
} from "@/lib/workspace/clients";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/clients/[id]
 *
 * One client, scoped to the authenticated account. An id belonging to another
 * account 404s exactly like a missing one — the rule refuses both with
 * `not_found`, so this route has no branch that could tell them apart.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const id = numericId((await params).id);
  if (id === null) return error("Invalid client id.", 400);

  const result = await getClientCompany(identity.userId, id);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json(toClientResponse(result.data));
}

/**
 * PUT /api/v1/clients/[id]
 *
 * A full replacement, not a merge: `clientCompanySchema` requires every field
 * the form requires, so a body that omits `email` is invalid rather than a
 * request to leave the existing address alone. PUT rather than PATCH says so
 * in the method.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const identity = await requireApiIdentity(request, { mutating: true });
  if (identity instanceof NextResponse) return identity;

  const id = numericId((await params).id);
  if (id === null) return error("Invalid client id.", 400);

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return error("Send a JSON object describing the client.", 400);
  }

  const updated = await updateClientCompany(identity.userId, id, body);
  if (!updated.ok) return workspaceError(updated);

  return NextResponse.json(toClientResponse(updated.data));
}

/**
 * DELETE /api/v1/clients/[id]
 *
 * Bounded by the database, not by this route: `Invoice.clientCompanyId` is
 * `onDelete: Restrict`, so a client any invoice was ever issued to cannot be
 * removed — Postgres raises the foreign-key violation the rule reports as
 * `in_use`, and this answers 409. Only a client with no invoices can be
 * deleted, which is why this verb is safe to expose to an API key that has no
 * scopes yet.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const identity = await requireApiIdentity(request, { mutating: true });
  if (identity instanceof NextResponse) return identity;

  const id = numericId((await params).id);
  if (id === null) return error("Invalid client id.", 400);

  const result = await deleteClientCompany(identity.userId, id);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json({ ok: true });
}
