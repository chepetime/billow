import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";

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

export class KeyHierarchyError extends Error {
  constructor(message = "The key could not be unwrapped.") {
    super(message);
    this.name = "KeyHierarchyError";
  }
}

/**
 * What a user's row must persist to be able to unlock again. Every field is
 * safe at rest: none of them yields the data key without a secret the server
 * does not keep.
 */
/**
 * The recovery arm is nullable because it is minted during onboarding rather
 * than at sign-up. A recovery key can only be shown once and is unrecoverable
 * afterwards, so it is issued where there is a page to display it, confirm it
 * by re-entry, and re-issue it until the user says they have written it down —
 * none of which a sign-up API response can offer.
 */
export type UserKeyset = {
  passwordSalt: string;
  dataKeyWrappedByPassword: string;
  recoverySalt: string | null;
  dataKeyWrappedByRecoveryKey: string | null;
};

// Crockford base32: no I, L, O or U, so nothing in a printed key can be
// mistaken for something else and "CUNT"-shaped accidents cannot occur.
const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_BYTES = 20;
const RECOVERY_GROUP = 4;

/**
 * 160 bits, printed as eight four-character groups. That is far beyond what a
 * password offers, which is why the recovery arm needs no other protection:
 * it is the one credential the user is told to write down and keep offline.
 */
function generateRecoveryKey(): string {
  const source = randomBytes(RECOVERY_BYTES);
  let bits = 0;
  let accumulator = 0;
  let out = "";

  for (const byte of source) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += RECOVERY_ALPHABET[(accumulator >> bits) & 31];
    }
  }

  return (out.match(new RegExp(`.{1,${RECOVERY_GROUP}}`, "g")) ?? []).join("-");
}

/**
 * Accepts a recovery key the way someone actually retypes one: any case, any
 * separators, and with the letters Crockford deliberately excluded folded
 * onto the digits they resemble. A key that only fails because it was read off
 * paper imperfectly is a key that has lost the user their data.
 */
export function normalizeRecoveryKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/[^0-9A-Z]/g, "");
}

/**
 * Binds a wrapped key to both its owner and the slot it belongs in, as GCM
 * associated data. Without the owner, a ciphertext could be copied into
 * another account's row; without the purpose, the password wrap could be
 * moved into the recovery slot and unwrapped by the wrong secret.
 */
function context(userId: string, purpose: string): Buffer {
  return Buffer.from(`billow:keyset:${purpose}:${VERSION}:${userId}`, "utf8");
}

function deriveKeyEncryptionKey(secret: string, salt: Buffer): Promise<Buffer> {
  if (!secret || secret.length > 1024) throw new KeyHierarchyError();

  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      secret,
      salt,
      KEY_BYTES,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAX_MEMORY },
      (error, derived) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derived);
      },
    );
  });
}

/** Returns `v1.iv.tag.ciphertext`, each binary segment base64url. */
function wrap(dataKey: Buffer, keyEncryptionKey: Buffer, aad: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyEncryptionKey, iv);
  cipher.setAAD(aad);
  const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    wrapped.toString("base64url"),
  ].join(".");
}

function unwrap(stored: string, keyEncryptionKey: Buffer, aad: Buffer): Buffer {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new KeyHierarchyError();

  const [, ivPart, tagPart, wrappedPart] = parts as [string, string, string, string];
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const wrapped = Buffer.from(wrappedPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new KeyHierarchyError();

  try {
    const decipher = createDecipheriv(ALGORITHM, keyEncryptionKey, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const dataKey = Buffer.concat([decipher.update(wrapped), decipher.final()]);
    if (dataKey.length !== KEY_BYTES) throw new KeyHierarchyError();
    return dataKey;
  } catch {
    // A wrong secret, a tampered wrap, and a wrap belonging to another user
    // are all the same answer. Distinguishing them tells an attacker which
    // half of the guess was right.
    throw new KeyHierarchyError();
  }
}

/**
 * Mints a user's data key and wraps it under a key derived from their
 * password. The data key is returned so the caller can start a session with
 * it; it is never persisted in this form.
 */
export async function createUserKeyset(
  userId: string,
  password: string,
): Promise<{ keyset: UserKeyset; dataKey: Buffer }> {
  if (!userId) throw new KeyHierarchyError("A keyset needs an owner.");

  const dataKey = randomBytes(KEY_BYTES);
  const passwordSalt = randomBytes(SALT_BYTES);
  const passwordKek = await deriveKeyEncryptionKey(password, passwordSalt);

  return {
    dataKey,
    keyset: {
      passwordSalt: passwordSalt.toString("base64url"),
      dataKeyWrappedByPassword: wrap(dataKey, passwordKek, context(userId, "password")),
      recoverySalt: null,
      dataKeyWrappedByRecoveryKey: null,
    },
  };
}

/**
 * Mints a recovery key and wraps the data key under it, replacing any previous
 * recovery arm. Takes the data key rather than the password because onboarding
 * runs against a signed-in session, where the password is long gone — and
 * because re-issuing must stay possible for a user who closed the tab before
 * writing the first key down.
 *
 * Re-issuing invalidates the previous key, which is the point: only one
 * recovery key is ever valid, so a key printed and discarded cannot come back.
 */
export async function issueRecoveryKey(
  userId: string,
  keyset: UserKeyset,
  dataKey: Buffer,
): Promise<{ keyset: UserKeyset; recoveryKey: string }> {
  if (!userId) throw new KeyHierarchyError("A keyset needs an owner.");
  if (dataKey.length !== KEY_BYTES) throw new KeyHierarchyError();

  const recoveryKey = generateRecoveryKey();
  const recoverySalt = randomBytes(SALT_BYTES);
  const recoveryKek = await deriveKeyEncryptionKey(
    normalizeRecoveryKey(recoveryKey),
    recoverySalt,
  );

  return {
    recoveryKey,
    keyset: {
      ...keyset,
      recoverySalt: recoverySalt.toString("base64url"),
      dataKeyWrappedByRecoveryKey: wrap(dataKey, recoveryKek, context(userId, "recovery")),
    },
  };
}

export async function unlockWithPassword(
  userId: string,
  keyset: UserKeyset,
  password: string,
): Promise<Buffer> {
  const salt = Buffer.from(keyset.passwordSalt, "base64url");
  if (salt.length !== SALT_BYTES) throw new KeyHierarchyError();

  const passwordKek = await deriveKeyEncryptionKey(password, salt);
  return unwrap(keyset.dataKeyWrappedByPassword, passwordKek, context(userId, "password"));
}

/**
 * Re-wraps the data key for one signed-in session. The session key is random
 * rather than derived: it already carries a full 256 bits, so no KDF is needed
 * and — critically — none is run. This is the path every request takes, and
 * scrypt on each one would cost tens of milliseconds per page render.
 *
 * The caller sends `sessionKey` to the browser in an httpOnly cookie and
 * stores `dataKeyWrappedBySessionKey` on the session row. Neither half is
 * useful alone: the server keeps a wrap it cannot open, and the cookie opens
 * nothing without the row it belongs to.
 */
export async function beginSession(
  userId: string,
  dataKey: Buffer,
): Promise<{ sessionKey: string; dataKeyWrappedBySessionKey: string }> {
  if (!userId) throw new KeyHierarchyError("A session needs an owner.");
  if (dataKey.length !== KEY_BYTES) throw new KeyHierarchyError();

  const sessionKey = randomBytes(KEY_BYTES);

  return {
    sessionKey: sessionKey.toString("base64url"),
    dataKeyWrappedBySessionKey: wrap(dataKey, sessionKey, context(userId, "session")),
  };
}

export async function resumeSession(
  userId: string,
  dataKeyWrappedBySessionKey: string,
  sessionKey: string,
): Promise<Buffer> {
  const key = Buffer.from(sessionKey, "base64url");
  if (key.length !== KEY_BYTES) throw new KeyHierarchyError();

  return unwrap(dataKeyWrappedBySessionKey, key, context(userId, "session"));
}

/**
 * Re-wraps the existing data key under a new password. Only the password arm
 * of the keyset moves: the data key is unchanged, so not a single stored row
 * has to be re-encrypted, and the recovery key issued at signup keeps working.
 */
async function rewrapUnderPassword(
  userId: string,
  keyset: UserKeyset,
  dataKey: Buffer,
  newPassword: string,
): Promise<UserKeyset> {
  const passwordSalt = randomBytes(SALT_BYTES);
  const passwordKek = await deriveKeyEncryptionKey(newPassword, passwordSalt);

  return {
    ...keyset,
    passwordSalt: passwordSalt.toString("base64url"),
    dataKeyWrappedByPassword: wrap(dataKey, passwordKek, context(userId, "password")),
  };
}

export async function changePassword(
  userId: string,
  keyset: UserKeyset,
  currentPassword: string,
  newPassword: string,
): Promise<UserKeyset> {
  const dataKey = await unlockWithPassword(userId, keyset, currentPassword);
  return rewrapUnderPassword(userId, keyset, dataKey, newPassword);
}

/**
 * The documented way through a forgotten password. Without the recovery key
 * there is no way back: resetting the password alone would leave the data key
 * wrapped under a secret nobody holds.
 */
export async function resetPasswordWithRecoveryKey(
  userId: string,
  keyset: UserKeyset,
  recoveryKey: string,
  newPassword: string,
): Promise<UserKeyset> {
  const dataKey = await unlockWithRecoveryKey(userId, keyset, recoveryKey);
  return rewrapUnderPassword(userId, keyset, dataKey, newPassword);
}

export async function unlockWithRecoveryKey(
  userId: string,
  keyset: UserKeyset,
  recoveryKey: string,
): Promise<Buffer> {
  // An account that never finished onboarding has no recovery arm. It fails
  // with the same error as a wrong key: whether a given account can be
  // recovered at all is not worth confirming to whoever is guessing.
  if (!keyset.recoverySalt || !keyset.dataKeyWrappedByRecoveryKey) throw new KeyHierarchyError();

  const salt = Buffer.from(keyset.recoverySalt, "base64url");
  if (salt.length !== SALT_BYTES) throw new KeyHierarchyError();

  const recoveryKek = await deriveKeyEncryptionKey(normalizeRecoveryKey(recoveryKey), salt);
  return unwrap(keyset.dataKeyWrappedByRecoveryKey, recoveryKek, context(userId, "recovery"));
}

const FIELD_PREFIX = "encv1";

/**
 * Encrypts one database field under the user's data key.
 *
 * `context` is the `Model.field` the value belongs to, bound as associated
 * data so a ciphertext cannot be moved between columns — an IBAN cannot be
 * pasted into the SWIFT column and still decrypt. It deliberately does not
 * include the row id: creates do not know their id yet, and a scheme that
 * only works on update is a scheme that gets bypassed. The consequence, worth
 * stating plainly, is that an attacker who can write to the database can move
 * a value between rows of the same column; they cannot read it.
 *
 * A fresh IV per write means two rows holding the same value do not look
 * alike, so the column leaks nothing to frequency analysis.
 */
export function encryptField(dataKey: Buffer, context: string, plaintext: string): string {
  if (dataKey.length !== KEY_BYTES) throw new KeyHierarchyError();

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dataKey, iv);
  cipher.setAAD(Buffer.from(`billow:field:${VERSION}:${context}`, "utf8"));
  const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [
    FIELD_PREFIX,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    sealed.toString("base64url"),
  ].join(".");
}

/**
 * Whether a stored value is one of ours. Anything else is treated as plaintext
 * written before encryption shipped, and returned unchanged — the alternative
 * is that enabling encryption makes every existing row unreadable.
 */
export function isEncryptedField(stored: unknown): stored is string {
  if (typeof stored !== "string") return false;
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== FIELD_PREFIX) return false;

  return (
    Buffer.from(parts[1]!, "base64url").length === IV_BYTES &&
    Buffer.from(parts[2]!, "base64url").length === TAG_BYTES
  );
}

export function decryptField(dataKey: Buffer, context: string, stored: string): string {
  if (!isEncryptedField(stored)) throw new KeyHierarchyError();
  if (dataKey.length !== KEY_BYTES) throw new KeyHierarchyError();

  const [, ivPart, tagPart, sealedPart] = stored.split(".") as [string, string, string, string];

  try {
    const decipher = createDecipheriv(ALGORITHM, dataKey, Buffer.from(ivPart, "base64url"));
    decipher.setAAD(Buffer.from(`billow:field:${VERSION}:${context}`, "utf8"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(sealedPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new KeyHierarchyError();
  }
}
