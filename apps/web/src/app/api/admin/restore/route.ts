import { gunzipSync } from "node:zlib";

import { NextResponse } from "next/server";

import { getAdminSession } from "@billow/auth";
import { error, validationError } from "@/lib/api/respond";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { readTar } from "@/lib/backup-archive";
import { restoreUploads } from "@/lib/backup-uploads";
import { importWorkspace, parseBackupPayload } from "@/lib/backup";
import { recordError } from "@/lib/error-log";
import { MAX_UPLOADS_PER_USER_BYTES } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * Ceiling on a decompressed archive.
 *
 * Gzip decompresses cheaply and enormously, so an attacker-supplied "zip
 * bomb" of a few hundred kilobytes could otherwise expand until the process
 * dies. The cap is the per-account upload quota plus room for the manifest —
 * anything larger could not be restored anyway.
 */
const MAX_ARCHIVE_BYTES = MAX_UPLOADS_PER_USER_BYTES + 16 * 1024 * 1024;

/**
 * POST /api/admin/restore
 *
 * Imports a previously exported backup into the signed-in administrator's own
 * account. Restoring only ever adds rows and files — it never trusts ids,
 * userId or storage keys in the file (see lib/backup.ts and
 * lib/backup-uploads.ts for the remap and scoping rules) and never deletes or
 * overwrites existing data.
 *
 * Accepts either the gzipped tar this build exports, or a bare JSON file from
 * a version 1 export. Those older backups are still complete records of
 * everything they ever held, so they restore normally and simply carry no
 * files.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return error("Invalid request origin.", 403);

  const { session, admin } = await getAdminSession();
  if (!session) return error("Authentication required.", 401);
  if (!admin) return error("Administrator access required.", 403);

  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.byteLength === 0) return error("Request body is empty.", 400);

  let manifestJson: unknown;
  const files = new Map<string, Buffer>();

  // Detected by content rather than Content-Type: the browser sends whatever
  // the file input reports, which for a .tar.gz varies by platform.
  const isGzip = raw[0] === 0x1f && raw[1] === 0x8b;

  if (isGzip) {
    try {
      const tarBytes = gunzipSync(raw, { maxOutputLength: MAX_ARCHIVE_BYTES });
      const entries = readTar(tarBytes, MAX_ARCHIVE_BYTES);

      const manifest = entries.find((entry) => entry.name === "backup.json");
      if (!manifest) {
        return error("Backup archive has no backup.json manifest.", 400);
      }
      manifestJson = JSON.parse(manifest.body.toString("utf8"));

      for (const entry of entries) {
        if (entry.name !== "backup.json") {
          files.set(entry.name, entry.body);
        }
      }
    } catch (archiveError) {
      await recordError("admin.backup.import.archive", archiveError);
      return error(
        archiveError instanceof Error
          ? archiveError.message
          : "Could not read the backup archive.",
        400,
      );
    }
  } else {
    try {
      manifestJson = JSON.parse(raw.toString("utf8"));
    } catch {
      return error("Request body must be a backup archive or JSON.", 400);
    }
  }

  const parsed = parseBackupPayload(manifestJson);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const summary = await importWorkspace(session.user.id, parsed.data.data);
    // Deliberately after the domain transaction commits — writing files is not
    // something Postgres can roll back. See lib/backup-uploads.ts.
    const uploads = await restoreUploads(
      session.user.id,
      parsed.data.data.uploads,
      files,
    );

    return NextResponse.json({ summary, uploads });
  } catch (importError) {
    await recordError("admin.backup.import", importError);
    return error("Could not import the backup file.", 500);
  }
}
