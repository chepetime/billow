import { NextResponse } from "next/server";

import { getAdminSession } from "@/lib/admin";
import { error, validationError } from "@/lib/api/respond";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { importWorkspace, parseBackupPayload } from "@/lib/backup";
import { recordError } from "@/lib/error-log";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/restore
 *
 * Imports a previously exported backup file into the signed-in
 * administrator's own account. Restoring only ever adds rows — it never
 * trusts ids or userId in the file (see lib/backup.ts for the remap and
 * scoping rules) and never deletes or overwrites existing data.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return error("Invalid request origin.", 403);

  const { session, admin } = await getAdminSession();
  if (!session) return error("Authentication required.", 401);
  if (!admin) return error("Administrator access required.", 403);

  const body = await request.json().catch(() => null);
  if (body === null) return error("Request body must be JSON.", 400);

  const parsed = parseBackupPayload(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const summary = await importWorkspace(session.user.id, parsed.data.data);
    return NextResponse.json({ summary });
  } catch (importError) {
    await recordError("admin.backup.import", importError);
    return error("Could not import the backup file.", 500);
  }
}
