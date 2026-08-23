import "server-only";

import { getPrisma } from "@billow/db";

import type { BackupData } from "@/lib/backup";
import {
  buildStorageKey,
  checksum,
  deleteObject,
  detectType,
  writeObject,
} from "@/lib/storage";
import { MAX_UPLOADS_PER_USER_BYTES, wouldExceedQuota } from "@/lib/uploads";

/**
 * Restoring the file half of a backup.
 *
 * Separate from lib/backup.ts on purpose: that module has no `server-only`
 * import so its schema can be unit tested without a database, and reaching
 * into storage.ts from there would break that. This module is the part that
 * touches the disk.
 *
 * It also runs *outside* the domain-data transaction, because a filesystem
 * write cannot be rolled back by Postgres. Files are restored first so the
 * domain transaction can reconnect document relations through `uploadIdMap`.
 * If that transaction fails, the route deletes every upload created here.
 * A process crash can still leave owner-scoped upload rows, but never invisible
 * bytes without rows; re-running or deleting those uploads is recoverable.
 */

export type UploadRestoreSummary = {
  uploads: number;
  skippedUploads: number;
  /** Human-readable reasons, surfaced so a partial restore is never silent. */
  reasons: string[];
  /** Internal remapping used to reconnect workflow-document relations. */
  uploadIdMap: Map<string, string>;
  /** Internal cleanup list if the later domain transaction fails. */
  restoredUploadIds: string[];
};

export async function restoreUploads(
  userId: string,
  uploads: BackupData["uploads"],
  files: Map<string, Buffer>,
): Promise<UploadRestoreSummary> {
  const prisma = getPrisma();
  const reasons: string[] = [];
  let restored = 0;
  let skipped = 0;
  const uploadIdMap = new Map<string, string>();
  const restoredUploadIds: string[] = [];

  const existing = await prisma.upload.aggregate({
    where: { userId },
    _sum: { size: true },
  });
  let usedBytes = existing._sum.size ?? 0;

  for (const upload of uploads) {
    const bytes = files.get(upload.archiveEntry);

    if (!bytes) {
      skipped += 1;
      reasons.push(`${upload.filename}: missing from the archive`);
      continue;
    }

    // The manifest is JSON and trivially editable; the bytes are the thing
    // being trusted. Verifying both the length and the digest means a restore
    // cannot be talked into storing content that differs from what was
    // exported, or into mis-accounting quota by lying about size.
    if (
      bytes.byteLength !== upload.size ||
      checksum(bytes) !== upload.checksum
    ) {
      skipped += 1;
      reasons.push(`${upload.filename}: contents do not match the manifest`);
      continue;
    }

    // Re-sniff rather than trusting the declared contentType, exactly as a
    // fresh upload does — a backup file is untrusted input on the way in.
    const detected = detectType(bytes);
    if (!detected) {
      skipped += 1;
      reasons.push(`${upload.filename}: not an accepted file type`);
      continue;
    }

    if (wouldExceedQuota(usedBytes, bytes.byteLength)) {
      skipped += 1;
      reasons.push(`${upload.filename}: would exceed the storage quota`);
      continue;
    }

    // A freshly generated key scoped to the importing user. Storage keys are
    // never taken from the archive, so a hand-edited backup cannot write into
    // another account's prefix.
    const key = buildStorageKey(userId, detected.ext);
    await writeObject(key, bytes);

    try {
      const created = await prisma.upload.create({
        data: {
          userId,
          storageKey: key,
          filename: upload.filename,
          contentType: detected.mime,
          size: bytes.byteLength,
          checksum: upload.checksum,
          // Start every restored file as a manageable account attachment.
          // The domain transaction promotes files it successfully reconnects
          // to invoice/tax documents. If a parent row is skipped, its file is
          // still visible to the owner instead of becoming hidden garbage.
          kind: "attachment",
        },
      });
      if (upload.id) uploadIdMap.set(upload.id, created.id);
      restoredUploadIds.push(created.id);
      usedBytes += bytes.byteLength;
      restored += 1;
    } catch (createError) {
      // Same rule as createUpload: never leave bytes with no row pointing at
      // them. A row whose bytes are gone would break every reader.
      await deleteObject(key);
      throw createError;
    }
  }

  if (skipped > 0) {
    reasons.unshift(
      `${skipped} of ${uploads.length} files were not restored (quota is ${Math.round(
        MAX_UPLOADS_PER_USER_BYTES / 1024 / 1024,
      )} MB per account).`,
    );
  }

  return {
    uploads: restored,
    skippedUploads: skipped,
    reasons,
    uploadIdMap,
    restoredUploadIds,
  };
}
