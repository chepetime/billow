import "server-only";

import { getPrisma } from "@billow/db";
import type { Upload } from "@billow/db/client";

import { formatBytes, type UploadResponse } from "@/lib/schemas/uploads";
import {
  buildStorageKey,
  checksum,
  deleteObject,
  detectType,
  MAX_UPLOAD_BYTES,
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

const ACCEPTED_TYPES_MESSAGE =
  "Accepted file types: PNG, JPEG, GIF, WEBP, PDF, CFDI XML.";

export function toUploadResponse(upload: Upload): UploadResponse {
  return {
    id: upload.id,
    filename: upload.filename,
    contentType: upload.contentType,
    size: upload.size,
    kind: upload.kind,
    createdAt: upload.createdAt.toISOString(),
  };
}

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

/**
 * The kinds an `Upload` row can carry. "attachment" is a file the account
 * owner uploaded directly; the other two are rows adopted by the invoice
 * workflow (see lib/actions/invoice-workflow.ts), which retags an attachment
 * once it is attached to an invoice or a tax period.
 */
export const UPLOAD_KINDS = [
  "attachment",
  "invoice_document",
  "tax_period_document",
] as const;

export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** What a list request asks for: one kind, or every kind at once. */
export type UploadKindFilter = UploadKind | "all";

export function isUploadKindFilter(value: string): value is UploadKindFilter {
  return value === "all" || (UPLOAD_KINDS as readonly string[]).includes(value);
}

async function usageBytes(userId: string): Promise<number> {
  const result = await getPrisma().upload.aggregate({
    where: { userId },
    _sum: { size: true },
  });
  return result._sum.size ?? 0;
}

/**
 * Total bytes stored, and the same figure split by kind with every known kind
 * present even at zero.
 *
 * The breakdown exists because the quota counts every row while the default
 * listing only shows attachments, so `usage.bytes` legitimately exceeds the
 * sum of the files in the response. Without it that reads as an accounting bug
 * and sends the caller looking for files that are not missing — they are
 * workflow documents, which the invoice UI owns and which are deliberately not
 * deletable from the files list.
 *
 * The total is summed from the same grouped rows rather than a second query,
 * so the two figures cannot disagree. It counts kinds this app does not know
 * about, which the breakdown does not report — the total is what the quota is
 * enforced on, so it must never be only the sum of the parts named here.
 */
async function usage(
  userId: string,
): Promise<{ bytes: number; byKind: Record<string, number> }> {
  const rows = await getPrisma().upload.groupBy({
    by: ["kind"],
    where: { userId },
    _sum: { size: true },
  });

  const byKind: Record<string, number> = Object.fromEntries(
    UPLOAD_KINDS.map((kind) => [kind, 0]),
  );
  let bytes = 0;
  for (const row of rows) {
    const size = row._sum.size ?? 0;
    bytes += size;
    if (row.kind in byKind) byKind[row.kind] += size;
  }
  return { bytes, byKind };
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
    throw new UploadRejectedError(
      `Unrecognized file type. ${ACCEPTED_TYPES_MESSAGE}`,
      415,
    );
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

/**
 * Lists an account's uploads, defaulting to the attachments the owner manages
 * directly. `kind` widens that: "all" returns workflow documents alongside
 * attachments, which is what makes the returned files reconcile against
 * `usageBytes`.
 *
 * The default stays "attachment" so the settings page and existing API callers
 * keep seeing exactly the files they can act on.
 */
export async function listUploads(
  userId: string,
  options: { kind?: UploadKindFilter } = {},
): Promise<{
  uploads: Upload[];
  usageBytes: number;
  usageByKind: Record<string, number>;
  limitBytes: number;
}> {
  const prisma = getPrisma();
  const kind = options.kind ?? "attachment";
  const [uploads, used] = await Promise.all([
    prisma.upload.findMany({
      where: { userId, ...(kind === "all" ? {} : { kind }) },
      orderBy: { createdAt: "desc" },
    }),
    usage(userId),
  ]);

  return {
    uploads,
    usageBytes: used.bytes,
    usageByKind: used.byKind,
    limitBytes: MAX_UPLOADS_PER_USER_BYTES,
  };
}

/**
 * Looks up an upload scoped to `userId`. Returns null both when the id
 * doesn't exist at all and when it belongs to another account — callers
 * must turn null into a 404, never a 403, so existence is never leaked.
 */
export async function getUploadForUser(
  userId: string,
  id: string,
): Promise<Upload | null> {
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
export async function deleteUpload(
  userId: string,
  id: string,
): Promise<boolean> {
  const upload = await getUploadForUser(userId, id);
  if (!upload) return false;

  await deleteObject(upload.storageKey);
  await getPrisma().upload.delete({ where: { id: upload.id } });
  return true;
}
