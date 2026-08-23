import { getAdminSession } from "@billow/auth";
import { getPrisma } from "@billow/db";
import { NextResponse } from "next/server";

import { isSameOriginRequest } from "@/lib/api/request-origin";
import { error } from "@/lib/api/respond";
import { recordError } from "@/lib/error-log";
import { deleteUserDirectory } from "@/lib/storage";

/**
 * DELETE /api/admin/workspace
 *
 * Clears the signed-in administrator's importable workspace while preserving
 * the account, sessions, key hierarchy, API keys, and installation ownership.
 * This is the safe reset before restoring a full backup into a non-empty
 * installation: ordinary restore is intentionally additive.
 *
 * Database rows are removed before stored bytes. Reversing that order could
 * leave live Upload rows pointing at files that no longer exist if the
 * transaction fails. A later file-cleanup failure instead leaves only
 * unreferenced bytes, which are harmless and can be swept independently.
 */
export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request))
    return error("Invalid request origin.", 403);

  const { session, admin } = await getAdminSession();
  if (!session) return error("Authentication required.", 401);
  if (!admin) return error("Administrator access required.", 403);

  const body = (await request.json().catch(() => null)) as {
    confirmation?: unknown;
  } | null;
  if (body?.confirmation !== "DELETE WORKSPACE") {
    return error('Type "DELETE WORKSPACE" to confirm the reset.', 400);
  }

  const userId = session.user.id;
  const prisma = getPrisma();
  const deleted = await prisma.$transaction(async (tx) => {
    // Invoices restrict deletion of their sender, bank, and client, so remove
    // them first. Their lines, revisions, and document links cascade.
    const invoices = await tx.invoice.deleteMany({ where: { userId } });
    // Tax-period document links cascade here. Upload rows are deleted last,
    // after every relation that could still point at one is gone.
    const taxPeriods = await tx.taxPeriod.deleteMany({ where: { userId } });
    const clientCompanies = await tx.clientCompany.deleteMany({
      where: { userId },
    });
    // Bank accounts cascade from their owning profile once invoices are gone.
    const userProfiles = await tx.userProfile.deleteMany({ where: { userId } });
    const uploads = await tx.upload.deleteMany({ where: { userId } });

    return {
      invoices: invoices.count,
      taxPeriods: taxPeriods.count,
      clientCompanies: clientCompanies.count,
      userProfiles: userProfiles.count,
      uploads: uploads.count,
    };
  });

  try {
    await deleteUserDirectory(userId);
  } catch (cleanupError) {
    // The sensitive filenames and storage keys are deliberately omitted.
    await recordError("admin.workspace.reset.files", cleanupError).catch(
      () => {},
    );
  }

  return NextResponse.json({ ok: true, deleted });
}
