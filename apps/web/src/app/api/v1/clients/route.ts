import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { error } from "@/lib/api/respond";
import { workspaceError } from "@/lib/api/workspace-route";
import { toClientResponse } from "@/lib/schemas/clients";
import {
  createClientCompany,
  listClientCompanies,
} from "@/lib/workspace/clients";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/clients
 *
 * The authenticated account's client companies, ordered by name.
 */
export async function GET(request: Request) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const clients = await listClientCompanies(identity.userId);
  if (!clients.ok) return workspaceError(clients);

  return NextResponse.json({ clients: clients.data.map(toClientResponse) });
}

/**
 * POST /api/v1/clients
 *
 * Creates a client company from a JSON body matching `clientCompanySchema`.
 * The rule validates — this route never checks a field itself, so the API and
 * the "New client" form cannot disagree about what a valid client is.
 */
export async function POST(request: Request) {
  const identity = await requireApiIdentity(request, { mutating: true });
  if (identity instanceof NextResponse) return identity;

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return error("Send a JSON object describing the client.", 400);
  }

  const created = await createClientCompany(identity.userId, body);
  if (!created.ok) return workspaceError(created);

  return NextResponse.json(toClientResponse(created.data), {
    status: 201,
    headers: { Location: `/api/v1/clients/${created.data.id}` },
  });
}
