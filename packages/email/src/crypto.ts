import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Encryption for provider credentials at rest.
 *
 * The Resend API key is set by an administrator through the UI, so it cannot
 * live in the environment like BETTER_AUTH_SECRET does — it has to be stored
 * in the database. A plaintext column would mean any read of that row (a
 * backup file, a stray query in a debug session, a restore dropped in the
 * wrong place) hands over a credential that can send mail as the install's
 * domain.
 *
 * The key is derived from BETTER_AUTH_SECRET rather than a new environment
 * variable: that secret already exists, is already required for the app to
 * boot, and is already per-install on Umbrel (${APP_SEED}). HKDF with a
 * distinct `info` string keeps this key separate from anything better-auth
 * derives from the same secret.
 *
 * Consequence worth knowing: rotating BETTER_AUTH_SECRET makes the stored
 * credential undecryptable. That is the correct failure — the app reports the
 * credential as unreadable and an administrator re-enters it, rather than the
 * app silently sending with a key the operator thought they had rotated away.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_INFO = "billow:email:credentials:v1";

export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialCryptoError";
  }
}

function deriveKey(): Buffer {
  const secret = process.env["BETTER_AUTH_SECRET"];
  if (!secret) {
    throw new CredentialCryptoError(
      "BETTER_AUTH_SECRET is not set, so provider credentials cannot be encrypted or read.",
    );
  }

  // Salt is intentionally empty: HKDF's salt is optional and the secret is
  // already high-entropy (64 hex chars from ${APP_SEED} on Umbrel). A random
  // salt would have to be stored alongside the ciphertext to be usable, which
  // buys nothing here.
  return Buffer.from(hkdfSync("sha256", secret, "", HKDF_INFO, KEY_BYTES));
}

/**
 * Returns `iv.tag.ciphertext`, each segment base64url. Anything unparseable
 * on the way back out is treated as corrupt rather than half-decrypted.
 */
export function encryptCredential(plaintext: string): string {
  if (!plaintext) {
    throw new CredentialCryptoError("Refusing to encrypt an empty credential.");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptCredential(stored: string): string {
  const parts = stored.split(".");
  if (parts.length !== 3) {
    throw new CredentialCryptoError(
      "Stored credential is malformed and cannot be read.",
    );
  }

  const [ivPart, tagPart, ciphertextPart] = parts as [string, string, string];
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new CredentialCryptoError(
      "Stored credential is malformed and cannot be read.",
    );
  }

  const decipher = createDecipheriv(ALGORITHM, deriveKey(), iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // GCM authentication failed: either the ciphertext was tampered with or
    // BETTER_AUTH_SECRET changed. Deliberately not distinguishing the two.
    throw new CredentialCryptoError(
      "Stored credential could not be decrypted. If BETTER_AUTH_SECRET was rotated, re-enter the API key.",
    );
  }
}

/**
 * A non-secret hint so an administrator can tell which key is stored without
 * the app ever returning the key itself. Resend keys look like `re_<random>`;
 * this keeps the prefix and the last four characters.
 */
export function previewCredential(plaintext: string): string {
  if (plaintext.length <= 8) return "••••";

  const prefixEnd = plaintext.indexOf("_");
  const prefix =
    prefixEnd > 0 && prefixEnd <= 6 ? plaintext.slice(0, prefixEnd + 1) : "";

  return `${prefix}••••${plaintext.slice(-4)}`;
}
