import "server-only";

import { getPrisma } from "@billow/db";
import type { Upload } from "@billow/db/client";

import { formatBytes } from "@/lib/schemas/uploads";
import {
  MAX_UPLOAD_BYTES,
  buildStorageKey,
  checksum,
  deleteObject,
  detectType,
  readObject,
  safeDisplayName,
  writeObject,
} from "@/lib/storage";

/**
 * Server-side create/list/delete for account attachments, built on
 * lib/storage.ts (bytes on disk) and Prisma (the `Upload` row). storage.ts
 * owns the security model — generated keys, sniffed types — this module
 * owns the account-scoping and quota rules on top of it.
 */

/**
 * Per-account cap on total stored bytes. Storage keys are sharded by user
 * (see buildStorageKey), so this is a straightforward sum over one user's
 * rows. Without a cap, one account could fill the host's uploads volume.
 */
export const MAX_UPLOADS_PER_USER_BYTES = 100 * 1024 * 1024;

const ACCEPTED_TYPES_MESSAGE = "Accepted file types: PNG, JPEG, GIF, WEBP, PDF.";

/** Thrown for any upload rejection; the API route maps `status` straight to the response. */
export class UploadRejectedError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadRejectedError";
    this.status = status;
  }
}

/** Pure quota check: would adding `incomingBytes` push the account over `limitBytes`? */
export function wouldExceedQuota(
  usedBytes: number,
  incomingBytes: number,
  limitBytes: number = MAX_UPLOADS_PER_USER_BYTES,
): boolean {
  return usedBytes + incomingBytes > limitBytes;
}

/** Quote-escape a filename for a Content-Disposition header value. */
export function contentDispositionHeader(filename: string): string {
  const escaped = filename.replace(/["\\]/g, (char) => `\\${char}`);
  return `attachment; filename="${escaped}"`;
}

async function usageBytes(userId: string): Promise<number> {
  const result = await getPrisma().upload.aggregate({
    where: { userId },
    _sum: { size: true },
  });
  return result._sum.size ?? 0;
}

/**
 * Validates, stores and records a new upload for `userId`.
 *
 * Ordering matters for partial failure: the object is written to disk
 * first, then the row is created. If the row insert fails, the just-written
 * object is deleted so it doesn't become an orphan with no metadata pointing
 * at it. We accept the (unlikely) inverse risk — a crash between the write
 * and the delete-on-failure leaving an orphaned file — over ever leaving a
 * `Upload` row whose bytes don't exist, since every reader (download, quota
 * accounting) assumes a row's bytes are present.
 */
export async function createUpload(
  userId: string,
  file: { name: string; bytes: Uint8Array },
): Promise<Upload> {
  if (file.bytes.length > MAX_UPLOAD_BYTES) {
    throw new UploadRejectedError(
      `File is too large. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      413,
    );
  }

  const detected = detectType(file.bytes);
  if (!detected) {
    throw new UploadRejectedError(`Unrecognized file type. ${ACCEPTED_TYPES_MESSAGE}`, 415);
  }

  const used = await usageBytes(userId);
  if (wouldExceedQuota(used, file.bytes.length)) {
    throw new UploadRejectedError(
      `Storage quota exceeded. This account has used ${formatBytes(used)} of ${formatBytes(MAX_UPLOADS_PER_USER_BYTES)}.`,
      409,
    );
  }

  const key = buildStorageKey(userId, detected.ext);
  await writeObject(key, file.bytes);

  try {
    return await getPrisma().upload.create({
      data: {
        userId,
        storageKey: key,
        filename: safeDisplayName(file.name),
        contentType: detected.mime,
        size: file.bytes.length,
        checksum: checksum(file.bytes),
      },
    });
  } catch (err) {
    // See the doc comment above: never leave a row-less object as the risk
    // taken here, only ever a row that outlives its (now-deleted) bytes.
    await deleteObject(key);
    throw err;
  }
}

export async function listUploads(
  userId: string,
): Promise<{ uploads: Upload[]; usageBytes: number; limitBytes: number }> {
  const prisma = getPrisma();
  const [uploads, used] = await Promise.all([
    prisma.upload.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    usageBytes(userId),
  ]);

  return { uploads, usageBytes: used, limitBytes: MAX_UPLOADS_PER_USER_BYTES };
}

/**
 * Looks up an upload scoped to `userId`. Returns null both when the id
 * doesn't exist at all and when it belongs to another account — callers
 * must turn null into a 404, never a 403, so existence is never leaked.
 */
export async function getUploadForUser(userId: string, id: string): Promise<Upload | null> {
  return getPrisma().upload.findFirst({ where: { id, userId } });
}

export async function readUploadBytes(upload: Upload): Promise<Buffer> {
  return readObject(upload.storageKey);
}

/**
 * Deletes the object then the row, scoped by userId. Returns false when no
 * matching row exists so the caller can 404 without leaking existence.
 *
 * The object is removed first. deleteObject tolerates an already-missing
 * file, so if this process dies between the two steps the result is a dead
 * metadata row (harmless, and cleanable later) rather than bytes left on
 * disk that no row references and the quota accounting no longer knows
 * about.
 */
export async function deleteUpload(userId: string, id: string): Promise<boolean> {
  const upload = await getUploadForUser(userId, id);
  if (!upload) return false;

  await deleteObject(upload.storageKey);
  await getPrisma().upload.delete({ where: { id: upload.id } });
  return true;
}
