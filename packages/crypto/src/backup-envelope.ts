import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  ALGORITHM,
  deriveKeyEncryptionKey,
  IV_BYTES,
  KEY_BYTES,
  KeyHierarchyError,
  normalizeRecoveryKey,
  SALT_BYTES,
  TAG_BYTES,
  unwrap,
  wrap,
} from "./key-hierarchy";

/**
 * Encryption for a workspace backup that has left the server.
 *
 * A plain export is decrypted by design — a backup nobody can read without the
 * app is not a backup — but it then lives in a Downloads folder, a cloud sync
 * root, and sometimes a support thread. This module is the opt-in alternative:
 * the same archive, sealed under the account's recovery key, so the file is
 * worth no more than the ciphertext in the database it came from.
 *
 * Shape, and why:
 *
 * - A random 256-bit **content key** encrypts the archive entries. The recovery
 *   key only wraps that key, so scrypt runs once per backup rather than once
 *   per file.
 * - Entries are sealed **individually**, not as one stream. Export reads one
 *   upload at a time on purpose (the container heap is 128 MB against a 100 MB
 *   per-account quota), and a single-stream cipher would have forced the whole
 *   archive into memory — reintroducing exactly the OOM the tar format exists
 *   to avoid. The cost is one extra copy of the largest single file.
 * - Each entry binds its own **archive entry name** as associated data, so the
 *   bytes of `files/0003` cannot be moved to `files/0000`, and no file can be
 *   substituted for the manifest.
 */

const VERSION = "v1";

/**
 * The one entry an encrypted archive leaves in the clear, so a restore can
 * tell an encrypted backup from a plain one and know what to ask for. It
 * carries a wrap and a salt; neither yields anything without the recovery key.
 */
export type BackupEnvelope = {
  version: typeof VERSION;
  kdf: "scrypt";
  /** base64url, `SALT_BYTES` long. */
  salt: string;
  /** The content key, as `v1.iv.tag.ciphertext`. */
  contentKeyWrapped: string;
};

/**
 * Deliberately *not* bound to a user id, unlike every wrap in the key
 * hierarchy.
 *
 * A backup exists to be restored somewhere else: a rebuilt install, a fresh
 * account, a different machine. `importWorkspace` already refuses to take
 * ownership from the file and assigns every row to the importing session, so
 * an owner in this AAD would add no authorization — it would only guarantee
 * that the one situation the feature is for is the one situation it fails in.
 */
const ENVELOPE_AAD = Buffer.from(`billow:backup:${VERSION}`, "utf8");

function entryContext(entryName: string): Buffer {
  return Buffer.from(`billow:backup-entry:${VERSION}:${entryName}`, "utf8");
}

/**
 * Mints a content key for one export and wraps it under the recovery key.
 *
 * The recovery key is normalised here rather than by the caller, the same way
 * `unlockWithRecoveryKey` does it: seal and open must agree on the exact bytes
 * fed to the KDF, and a key retyped off paper with different casing or dashes
 * must still open the file it was used to seal.
 */
export async function sealBackupWithRecoveryKey(
  recoveryKey: string,
): Promise<{ envelope: BackupEnvelope; contentKey: Buffer }> {
  const salt = randomBytes(SALT_BYTES);
  const keyEncryptionKey = await deriveKeyEncryptionKey(
    normalizeRecoveryKey(recoveryKey),
    salt,
  );
  const contentKey = randomBytes(KEY_BYTES);

  return {
    contentKey,
    envelope: {
      version: VERSION,
      kdf: "scrypt",
      salt: salt.toString("base64url"),
      contentKeyWrapped: wrap(contentKey, keyEncryptionKey, ENVELOPE_AAD),
    },
  };
}

/**
 * Recovers the content key from an envelope. Throws `KeyHierarchyError` for a
 * wrong key, a tampered wrap and a malformed envelope alike — a restore has
 * nothing to gain from being told which.
 */
export async function openBackupWithRecoveryKey(
  envelope: BackupEnvelope,
  recoveryKey: string,
): Promise<Buffer> {
  const salt = Buffer.from(envelope.salt, "base64url");
  if (salt.length !== SALT_BYTES) throw new KeyHierarchyError();

  const keyEncryptionKey = await deriveKeyEncryptionKey(
    normalizeRecoveryKey(recoveryKey),
    salt,
  );
  return unwrap(envelope.contentKeyWrapped, keyEncryptionKey, ENVELOPE_AAD);
}

/**
 * Validates an envelope read out of an untrusted archive. Returns null rather
 * than throwing: "this file is not an encrypted backup we can read" is a
 * routine answer the restore endpoint reports as a 400, not an error.
 */
export function parseBackupEnvelope(value: unknown): BackupEnvelope | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (candidate.version !== VERSION) return null;
  if (candidate.kdf !== "scrypt") return null;
  if (typeof candidate.salt !== "string") return null;
  if (typeof candidate.contentKeyWrapped !== "string") return null;

  return {
    version: VERSION,
    kdf: "scrypt",
    salt: candidate.salt,
    contentKeyWrapped: candidate.contentKeyWrapped,
  };
}

/** Returns `iv || tag || ciphertext` — binary, because these are file bytes. */
export function sealBackupEntry(
  contentKey: Buffer,
  entryName: string,
  plaintext: Buffer,
): Buffer {
  if (contentKey.length !== KEY_BYTES) throw new KeyHierarchyError();

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, contentKey, iv);
  cipher.setAAD(entryContext(entryName));
  const sealed = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), sealed]);
}

export function openBackupEntry(
  contentKey: Buffer,
  entryName: string,
  sealed: Buffer,
): Buffer {
  if (contentKey.length !== KEY_BYTES) throw new KeyHierarchyError();
  if (sealed.length < IV_BYTES + TAG_BYTES) throw new KeyHierarchyError();

  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = sealed.subarray(IV_BYTES + TAG_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, contentKey, iv);
    decipher.setAAD(entryContext(entryName));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new KeyHierarchyError("The backup entry could not be decrypted.");
  }
}
