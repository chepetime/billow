import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { workspaceError } from "@/lib/api/workspace-route";
import { listSenderProfiles } from "@/lib/workspace/references";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/sender-profiles
 *
 * The identities invoices are issued from, as `userProfileId` values to pick
 * between. Read-only, and without `taxId` or `address`: those are sealed under
 * the owner's data key, which no API key can reach, so returning them would
 * return nulls. Managing a profile stays in the browser for the same reason.
 */
export async function GET(request: Request) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const result = await listSenderProfiles(identity.userId);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json({ senderProfiles: result.data });
}
