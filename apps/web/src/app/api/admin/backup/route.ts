import { NextResponse } from "next/server";

import { getAdminSession } from "@/lib/admin";
import { error } from "@/lib/api/respond";
import { exportWorkspace } from "@/lib/backup";
import { recordError } from "@/lib/error-log";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/backup
 *
 * Exports the signed-in administrator's own domain data (profiles, bank
 * accounts, clients, invoices with line items and revisions) as a downloadable
 * JSON file. See lib/backup.ts for exactly what is and is not included.
 */
export async function GET() {
  const { session, admin } = await getAdminSession();
  if (!session) return error("Authentication required.", 401);
  if (!admin) return error("Administrator access required.", 403);

  try {
    const payload = await exportWorkspace(session.user.id);
    const filename = `billow-backup-${new Date().toISOString().slice(0, 10)}.json`;

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (exportError) {
    await recordError("admin.backup.export", exportError);
    return error("Could not build the backup file.", 500);
  }
}
