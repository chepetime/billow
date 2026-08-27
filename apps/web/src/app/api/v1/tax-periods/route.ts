import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { error } from "@/lib/api/respond";
import { workspaceError } from "@/lib/api/workspace-route";
import { toTaxPeriodResponse } from "@/lib/schemas/tax-periods";
import { createTaxPeriod, listTaxPeriods } from "@/lib/workspace/tax-periods";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/tax-periods
 *
 * The authenticated account's monthly filings, most recent month first, each
 * with its attached documents.
 */
export async function GET(request: Request) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const periods = await listTaxPeriods(identity.userId);
  if (!periods.ok) return workspaceError(periods);

  return NextResponse.json({
    taxPeriods: periods.data.map(toTaxPeriodResponse),
  });
}

/**
 * POST /api/v1/tax-periods
 *
 * Creates the filing record for one month. A month that already has one is a
 * 409, not an overwrite: the constraint is `@@unique([userId, year, month])`,
 * and quietly upserting would let a retry replace a filing date.
 */
export async function POST(request: Request) {
  const identity = await requireApiIdentity(request, { mutating: true });
  if (identity instanceof NextResponse) return identity;

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return error("Send a JSON object describing the tax period.", 400);
  }

  const created = await createTaxPeriod(identity.userId, body);
  if (!created.ok) return workspaceError(created);

  return NextResponse.json(toTaxPeriodResponse(created.data), {
    status: 201,
    headers: { Location: `/api/v1/tax-periods/${created.data.id}` },
  });
}
