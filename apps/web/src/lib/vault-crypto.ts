import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

export class VaultCryptoError extends Error {
  constructor(message = "The vault key cannot unlock this entry.") {
    super(message);
    this.name = "VaultCryptoError";
  }
}

function associatedData(userId: string) {
  // Authenticated associated data prevents an attacker who can edit the
  // database from copying a ciphertext to a different account and having it
  // appear as that account's vault entry.
  return Buffer.from(`billow:vault:${VERSION}:${userId}`, "utf8");
}

async function deriveKey(vaultKey: string, salt: Buffer): Promise<Buffer> {
  if (!vaultKey || vaultKey.length > 1024) throw new VaultCryptoError();

  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(vaultKey, salt, KEY_BYTES, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived);
    });
  });
}

/**
 * Encrypts one experimental vault payload. The encoded value is
 * `v1.salt.iv.tag.ciphertext`, all binary segments base64url. The random salt
 * makes a reused vault key yield unrelated database values for every write.
 */
export async function encryptVaultPayload(
  userId: string,
  vaultKey: string,
  plaintext: string,
): Promise<string> {
  if (!userId || !plaintext || plaintext.length > 4096) {
    throw new VaultCryptoError("Vault payload is invalid.");
  }

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, await deriveKey(vaultKey, salt), iv);
  cipher.setAAD(associatedData(userId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [
    VERSION,
    salt.toString("base64url"),
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export async function decryptVaultPayload(
  userId: string,
  vaultKey: string,
  stored: string,
): Promise<string> {
  const parts = stored.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) throw new VaultCryptoError();

  const [, saltPart, ivPart, tagPart, ciphertextPart] = parts;
  const salt = Buffer.from(saltPart, "base64url");
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new VaultCryptoError();
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, await deriveKey(vaultKey, salt), iv);
    decipher.setAAD(associatedData(userId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Do not distinguish a wrong key, tampering, or a swapped owner binding.
    throw new VaultCryptoError();
  }
}
