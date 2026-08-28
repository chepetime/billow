import { gunzipSync } from "node:zlib";
import { getAdminSession } from "@billow/auth";
import {
  KeyHierarchyError,
  openBackupEntry,
  openBackupWithRecoveryKey,
  parseBackupEnvelope,
} from "@billow/crypto";
import { NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { error, validationError } from "@/lib/api/respond";
import { importWorkspace, parseBackupPayload } from "@/lib/backup";
import { readTar, type TarEntry } from "@/lib/backup-archive";
import {
  ENVELOPE_ENTRY,
  MANIFEST_ENTRY,
  RECOVERY_KEY_HEADER,
} from "@/lib/backup-format";
import { restoreUploads } from "@/lib/backup-uploads";
import { recordError } from "@/lib/error-log";
import { deleteUpload, MAX_UPLOADS_PER_USER_BYTES } from "@/lib/uploads";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

export const dynamic = "force-dynamic";

/**
 * Describes what a restore would collide with, or null when the workspace is
 * empty enough to receive one.
 *
 * Counts rather than a boolean so the refusal can say what is in the way —
 * "this workspace still has 9 invoices" is actionable, "not empty" is not.
 * Uploads are deliberately not counted: restoreUploads adds files beside
 * whatever is there and an orphaned upload is harmless, unlike a duplicated
 * invoice.
 */
async function workspaceIsOccupied(userId: string): Promise<string | null> {
  const { prisma } = await getWorkspacePrisma();
  const [invoices, profiles, clients] = await Promise.all([
    prisma.invoice.count({ where: { userId } }),
    prisma.userProfile.count({ where: { userId } }),
    prisma.clientCompany.count({ where: { userId } }),
  ]);

  const parts = [
    invoices > 0 && `${invoices} invoice${invoices === 1 ? "" : "s"}`,
    profiles > 0 && `${profiles} sender profile${profiles === 1 ? "" : "s"}`,
    clients > 0 && `${clients} client${clients === 1 ? "" : "s"}`,
  ].filter((part): part is string => typeof part === "string");

  return parts.length > 0 ? parts.join(", ") : null;
}

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
 *
 * An archive carrying a `backup-envelope.json` entry is an encrypted export
 * and needs the recovery key it was sealed with, in `x-billow-recovery-key`.
 * That key is not checked against this account, unlike on export: a backup is
 * restored into a rebuilt install or a new account precisely when the original
 * account no longer exists, so the only thing that can vouch for the key is
 * the envelope itself.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return error("Invalid request origin.", 403);

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
    let entries: TarEntry[] = [];
    try {
      const tarBytes = gunzipSync(raw, { maxOutputLength: MAX_ARCHIVE_BYTES });
      entries = readTar(tarBytes, MAX_ARCHIVE_BYTES);
    } catch (archiveError) {
      await recordError("admin.backup.import.archive", archiveError);
      return error(
        archiveError instanceof Error
          ? archiveError.message
          : "Could not read the backup archive.",
        400,
      );
    }

    const manifest = entries.find((entry) => entry.name === MANIFEST_ENTRY);
    if (!manifest) {
      return error(`Backup archive has no ${MANIFEST_ENTRY} manifest.`, 400);
    }

    const header = entries.find((entry) => entry.name === ENVELOPE_ENTRY);
    let contentKey: Buffer | null = null;

    if (header) {
      const recoveryKey =
        request.headers.get(RECOVERY_KEY_HEADER)?.trim() ?? "";
      if (!recoveryKey) {
        return error(
          "This backup is encrypted. Enter the recovery key it was exported with.",
          400,
        );
      }

      let envelope: ReturnType<typeof parseBackupEnvelope>;
      try {
        envelope = parseBackupEnvelope(
          JSON.parse(header.body.toString("utf8")),
        );
      } catch {
        envelope = null;
      }
      if (!envelope) {
        return error(
          "This backup is encrypted in a format this version cannot read.",
          400,
        );
      }

      try {
        contentKey = await openBackupWithRecoveryKey(envelope, recoveryKey);
      } catch (unlockError) {
        if (unlockError instanceof KeyHierarchyError) {
          return error("That recovery key does not open this backup.", 400);
        }
        throw unlockError;
      }
    }

    /**
     * Every entry is authenticated to its own name, so a failure here means
     * the archive was edited after it was sealed — not that the key is wrong,
     * which `openBackupWithRecoveryKey` has already settled.
     */
    const open = (name: string, body: Buffer): Buffer | null => {
      if (!contentKey) return body;
      try {
        return openBackupEntry(contentKey, name, body);
      } catch {
        return null;
      }
    };

    const manifestBytes = open(MANIFEST_ENTRY, manifest.body);
    if (!manifestBytes) {
      return error("This backup's manifest failed its integrity check.", 400);
    }

    try {
      manifestJson = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      return error("Backup archive manifest is not valid JSON.", 400);
    }

    for (const entry of entries) {
      if (entry.name === MANIFEST_ENTRY || entry.name === ENVELOPE_ENTRY) {
        continue;
      }
      // A file that fails to decrypt is left out rather than failing the whole
      // restore, and its absence is then reported by restoreUploads as a
      // missing entry — the same visible outcome as a file the export skipped.
      const bytes = open(entry.name, entry.body);
      if (bytes) files.set(entry.name, bytes);
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

  const occupied = await workspaceIsOccupied(session.user.id);
  if (occupied) {
    // importWorkspace creates unconditionally — it maps old ids to new rows
    // rather than matching existing ones — so restoring onto a workspace that
    // already holds data duplicates all of it: two sender profiles, two of
    // each bank account and client, and invoices split between the copies.
    // That is not recoverable through this API afterwards, because the
    // duplicates are only distinguishable by which invoices point at them.
    //
    // The workspace reset exists to be run first. Refusing here is what makes
    // it the path rather than a suggestion.
    return error(
      `This workspace still has ${occupied}. Restoring onto it would duplicate every record instead of replacing them. Reset the workspace first, then restore.`,
      409,
    );
  }

  try {
    const uploads = await restoreUploads(
      session.user.id,
      parsed.data.data.uploads,
      files,
    );
    let summary: Awaited<ReturnType<typeof importWorkspace>>;
    try {
      summary = await importWorkspace(
        session.user.id,
        parsed.data.data,
        uploads.uploadIdMap,
      );
    } catch (importError) {
      await Promise.allSettled(
        uploads.restoredUploadIds.map((id) =>
          deleteUpload(session.user.id, id),
        ),
      );
      throw importError;
    }

    const {
      uploadIdMap: _uploadIdMap,
      restoredUploadIds: _ids,
      ...publicUploads
    } = uploads;

    return NextResponse.json({ summary, uploads: publicUploads });
  } catch (importError) {
    await recordError("admin.backup.import", importError);
    return error("Could not import the backup file.", 500);
  }
}
