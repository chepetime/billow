import "server-only";

import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Local filesystem storage for account attachments.
 *
 * Bytes live on the mounted uploads volume, never in the database, and never
 * inside the container filesystem — see `BILLOW_STORAGE_DIR` and the volume in
 * the Umbrel compose file. Only metadata is recorded in `Upload`.
 *
 * The storage key is generated here and is the only thing that ever reaches
 * the filesystem. The client's filename is stored for display but is never
 * used to build a path, which is what makes traversal (`../../etc/passwd`)
 * impossible rather than merely filtered.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Accepted types, with the magic bytes that must actually be present. */
const ACCEPTED = [
  { mime: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", ext: "gif", magic: [0x47, 0x49, 0x46, 0x38] },
  { mime: "application/pdf", ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
] as const;

/** WEBP is RIFF....WEBP, so it needs a check at two offsets. */
function isWebp(bytes: Uint8Array): boolean {
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  return (
    riff.every((b, i) => bytes[i] === b) &&
    webp.every((b, i) => bytes[8 + i] === b)
  );
}

export type DetectedType = { mime: string; ext: string };

/**
 * Identify a file from its leading bytes. `Content-Type` from the browser is
 * attacker-controlled and is deliberately ignored: a `.pdf` claiming to be an
 * image, or a script renamed to `.png`, is rejected here.
 */
export function detectType(bytes: Uint8Array): DetectedType | null {
  for (const candidate of ACCEPTED) {
    if (candidate.magic.every((b, i) => bytes[i] === b)) {
      return { mime: candidate.mime, ext: candidate.ext };
    }
  }
  if (isWebp(bytes)) return { mime: "image/webp", ext: "webp" };
  return null;
}

/** Display-safe filename: strips any path structure the client supplied. */
export function safeDisplayName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "file";
  // Written as escapes because the literal control bytes were previously
  // inlined into this regex, where no editor renders them.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point -- they are what make a client-supplied filename unsafe to display.
  return base.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 120) || "file";
}

export function storageRoot(): string {
  return process.env.BILLOW_STORAGE_DIR ?? "/data/uploads";
}

/**
 * Keys are `<userId>/<uuid>.<ext>`. Sharding by user keeps one account's files
 * together for deletion and quota accounting.
 */
export function buildStorageKey(userId: string, ext: string): string {
  return `${userId}/${randomUUID()}.${ext}`;
}

/** Resolve a key to an absolute path, refusing anything that escapes the root. */
export function resolveStoragePath(key: string): string {
  const root = path.resolve(storageRoot());
  const target = path.resolve(root, key);

  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Refusing to resolve a path outside the storage root.");
  }

  return target;
}

export async function writeObject(key: string, bytes: Uint8Array) {
  const target = resolveStoragePath(key);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, bytes);
}

export async function readObject(key: string): Promise<Buffer> {
  return fsp.readFile(resolveStoragePath(key));
}

export async function deleteObject(key: string) {
  await fsp.rm(resolveStoragePath(key), { force: true });
}

/**
 * Resolve the directory holding one user's objects (see `buildStorageKey`:
 * keys are `<userId>/<uuid>.<ext>`). Built on `resolveStoragePath`'s
 * containment guard rather than a second copy of it, plus one addition that
 * guard doesn't need for its existing single-file callers: a key that
 * resolves to the root *itself* (an empty or `.` userId) passes containment
 * — it hasn't escaped — but it must never be handed to a recursive delete,
 * which would erase every user's files. Only a real, non-root subdirectory
 * of the storage root is returned.
 */
export function resolveUserDirectory(userId: string): string {
  if (!userId) {
    throw new Error(
      "Refusing to resolve a storage directory for an empty user id.",
    );
  }

  const root = path.resolve(storageRoot());
  const target = resolveStoragePath(userId);

  if (target === root) {
    throw new Error(
      "Refusing to resolve a user directory that is the storage root.",
    );
  }

  return target;
}

/**
 * Recursively removes everything under one user's storage directory.
 * `force: true` makes a missing directory (no uploads ever made) a no-op
 * rather than an error, matching `deleteObject`'s tolerance for an
 * already-absent target.
 */
export async function deleteUserDirectory(userId: string): Promise<void> {
  const target = resolveUserDirectory(userId);
  await fsp.rm(target, { recursive: true, force: true });
}

export function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
