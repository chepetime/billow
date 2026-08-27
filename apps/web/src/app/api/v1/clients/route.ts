import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { error } from "@/lib/api/respond";
import { workspaceError } from "@/lib/api/workspace-response";
import { toClientResponse } from "@/lib/schemas/clients";
import { createClientCompany, getClientCompany } from "@/lib/workspace/clients";
import { listClientCompanies } from "@/lib/workspace-records";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/clients
 *
 * The authenticated account's client companies, ordered by name.
 */
export async function GET(request: Request) {
  const identity = await requireApiIdentity(request.headers);
  if (identity instanceof NextResponse) return identity;

  const { clients } = await listClientCompanies(identity.userId);
  return NextResponse.json({ clients: clients.map(toClientResponse) });
}

/**
 * POST /api/v1/clients
 *
 * Creates a client company from a JSON body matching `clientCompanySchema`.
 * The rule validates — this route never checks a field itself, so the API and
 * the "New client" form cannot disagree about what a valid client is.
 */
export async function POST(request: Request) {
  // Credentials first: a 403 for an unauthenticated caller would say
  // "forbidden" when what they need is to authenticate. Same ordering as the
  // uploads routes.
  const identity = await requireApiIdentity(request.headers);
  if (identity instanceof NextResponse) return identity;

  if (identity.via === "session" && !isSameOriginRequest(request)) {
    return error("Invalid request origin.", 403);
  }

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return error("Send a JSON object describing the client.", 400);
  }

  const created = await createClientCompany(identity.userId, body);
  if (!created.ok) return workspaceError(created);

  // Read the row back rather than echoing the request: the response then
  // carries the server's timestamps and its own normalisation, so a client
  // that stores what it gets holds what the database holds.
  const client = await getClientCompany(identity.userId, created.data.id);
  if (!client.ok) return workspaceError(client);

  return NextResponse.json(toClientResponse(client.data), {
    status: 201,
    headers: { Location: `/api/v1/clients/${created.data.id}` },
  });
}
