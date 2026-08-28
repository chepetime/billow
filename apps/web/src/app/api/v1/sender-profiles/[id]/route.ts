import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { error } from "@/lib/api/respond";
import { numericId, workspaceError } from "@/lib/api/workspace-route";
import { deleteSenderProfile } from "@/lib/workspace/references";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * DELETE /api/v1/sender-profiles/[id]
 *
 * Refused with 409 while any invoice still references it — `Invoice.userProfileId`
 * is `onDelete: Restrict`, so the database bounds this the same way it bounds
 * deleting a client. Needs a read-and-write key.
 *
 * There is no POST or PUT here on purpose: this model holds columns sealed
 * under the owner's data key, which an API key cannot reach, so a create or
 * update would be refused by the encryption guard. A delete writes no column,
 * which is why it works.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const identity = await requireApiIdentity(request, { mutating: true });
  if (identity instanceof NextResponse) return identity;

  const id = numericId((await params).id);
  if (id === null) return error("Invalid sender profile id.", 400);

  const result = await deleteSenderProfile(identity.userId, id);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json({ ok: true });
}
