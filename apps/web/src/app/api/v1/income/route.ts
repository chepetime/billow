import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { workspaceError } from "@/lib/api/workspace-route";
import { getIncomeSummary } from "@/lib/workspace/income";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/income?year=2026
 *
 * A fiscal year in one response: what was invoiced and what was paid, per
 * month and per currency, with each month's CFDI count and the state of its
 * tax filing. Defaults to the current year.
 *
 * Everything is grouped by currency and never summed across it. The dashboard
 * adds every invoice into one figure labelled MXN, which is fine for a glance
 * and wrong for a tax summary — a USD invoice is not worth its face value in
 * pesos, and no exchange rate is stored anywhere to convert it. A consumer
 * that wants one number has to supply the rate it used.
 */
export async function GET(request: Request) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const requested = new URL(request.url).searchParams.get("year");
  const year =
    requested === null ? new Date().getFullYear() : Number(requested);

  const result = await getIncomeSummary(identity.userId, year);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json(result.data);
}
