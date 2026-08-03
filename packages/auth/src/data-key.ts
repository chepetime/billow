import "server-only";

import { cookies } from "next/headers";

import {
  KeyHierarchyError,
  beginSession,
  changePassword,
  createUserKeyset,
  resumeSession,
  unlockWithPassword,
  type UserKeyset,
} from "@billow/crypto";
import { getPrisma } from "@billow/db";

/**
 * The session key. httpOnly so no script can read it, and paired with a wrap
 * on the session row that is inert without it. Deliberately not `secure`:
 * Umbrel serves this app over plain HTTP, and a `secure` cookie would simply
 * never be sent, silently breaking decryption on the default install. That is
 * the same transport limitation that keeps HSTS off and passkeys deferred.
 */
export const DATA_KEY_COOKIE = "billow.data_key";

/**
 * Carries the data key across two-factor verification. With 2FA on, the
 * password arrives at /sign-in/email but no session exists until
 * /two-factor/verify-*, so the key would otherwise be lost in between.
 */
const PENDING_COOKIE = "billow.data_key_pending";
const PENDING_TTL_MS = 10 * 60 * 1000;

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
} as const;

function pendingIdentifier(userId: string) {
  return `data-key-pending:${userId}`;
}

/** Mints a keyset for a brand-new account. The recovery arm comes later. */
export async function enrollUser(userId: string, password: string): Promise<Buffer> {
  const { keyset, dataKey } = await createUserKeyset(userId, password);

  await getPrisma().userKeyset.create({ data: { userId, ...keyset } });

  return dataKey;
}

/**
 * Unwraps the data key with the password. Returns null when the account has no
 * keyset — every account created before this shipped is in that state, and
 * they must keep being able to sign in.
 */
export async function unlockDataKey(userId: string, password: string): Promise<Buffer | null> {
  const stored = await getPrisma().userKeyset.findUnique({ where: { userId } });
  if (!stored) return null;

  try {
    return await unlockWithPassword(userId, stored as UserKeyset, password);
  } catch (error) {
    // The password already authenticated, so a failure here is a corrupt or
    // mismatched keyset rather than a wrong guess. Signing in without a data
    // key is the right outcome: encrypted fields read as unavailable instead
    // of the whole sign-in failing.
    if (error instanceof KeyHierarchyError) return null;
    throw error;
  }
}

/**
 * Follows a password change by re-wrapping the data key under the new one.
 * Without this the keyset would still be sealed under the old password and the
 * user would lose every encrypted field at their next sign-in — silently, and
 * with nothing left to recover from but the recovery key.
 *
 * Returns the data key so the caller can re-open the session, since changing a
 * password can revoke and replace it.
 */
export async function rewrapForNewPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<Buffer | null> {
  const prisma = getPrisma();
  const stored = await prisma.userKeyset.findUnique({ where: { userId } });
  if (!stored) return null;

  try {
    const keyset = await changePassword(
      userId,
      stored as UserKeyset,
      currentPassword,
      newPassword,
    );
    await prisma.userKeyset.update({
      where: { userId },
      data: {
        passwordSalt: keyset.passwordSalt,
        dataKeyWrappedByPassword: keyset.dataKeyWrappedByPassword,
      },
    });

    return await unlockWithPassword(userId, keyset, newPassword);
  } catch (error) {
    if (error instanceof KeyHierarchyError) return null;
    throw error;
  }
}

/**
 * Re-wraps the data key for one session: the wrap goes on the session row, the
 * key it needs goes to the browser. Returns the cookie value for the caller to
 * set, because the auth hook and a route handler set cookies differently.
 */
export async function openSessionDataKey(
  userId: string,
  sessionId: string,
  dataKey: Buffer,
): Promise<string> {
  const { sessionKey, dataKeyWrappedBySessionKey } = await beginSession(userId, dataKey);

  await getPrisma().session.update({
    where: { id: sessionId },
    data: { dataKeyWrappedBySessionKey },
  });

  return sessionKey;
}

/**
 * Parks the data key while the user completes two-factor verification. The
 * wrap lives in `Verification` — better-auth's own short-lived store — and its
 * key rides in a separate cookie, so neither half is useful alone and both
 * expire quickly.
 */
export async function parkDataKeyForTwoFactor(
  userId: string,
  dataKey: Buffer,
): Promise<string> {
  const { sessionKey, dataKeyWrappedBySessionKey } = await beginSession(userId, dataKey);
  const prisma = getPrisma();
  const identifier = pendingIdentifier(userId);

  await prisma.verification.deleteMany({ where: { identifier } });
  await prisma.verification.create({
    data: {
      identifier,
      value: dataKeyWrappedBySessionKey,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    },
  });

  return sessionKey;
}

/** Recovers a parked data key once two-factor verification has succeeded. */
export async function claimParkedDataKey(
  userId: string,
  pendingKey: string,
): Promise<Buffer | null> {
  const prisma = getPrisma();
  const identifier = pendingIdentifier(userId);
  const parked = await prisma.verification.findFirst({
    where: { identifier },
    orderBy: { createdAt: "desc" },
  });

  await prisma.verification.deleteMany({ where: { identifier } });
  if (!parked || parked.expiresAt < new Date()) return null;

  try {
    return await resumeSession(userId, parked.value, pendingKey);
  } catch (error) {
    if (error instanceof KeyHierarchyError) return null;
    throw error;
  }
}

/**
 * The data key for the signed-in request, or null when there is none to be
 * had — no cookie, a session predating the keyset, or an API-key caller, which
 * has no cookie by definition and so cannot decrypt.
 *
 * Null is a normal answer, not an error: callers render encrypted fields as
 * unavailable rather than failing the page.
 */
export async function getDataKey(userId: string, sessionId: string): Promise<Buffer | null> {
  const sessionKey = (await cookies()).get(DATA_KEY_COOKIE)?.value;
  if (!sessionKey) return null;

  const session = await getPrisma().session.findUnique({
    where: { id: sessionId },
    select: { dataKeyWrappedBySessionKey: true },
  });
  if (!session?.dataKeyWrappedBySessionKey) return null;

  try {
    return await resumeSession(userId, session.dataKeyWrappedBySessionKey, sessionKey);
  } catch (error) {
    if (error instanceof KeyHierarchyError) return null;
    throw error;
  }
}

export const dataKeyCookies = {
  name: DATA_KEY_COOKIE,
  pendingName: PENDING_COOKIE,
  options: COOKIE_OPTIONS,
  pendingOptions: { ...COOKIE_OPTIONS, maxAge: PENDING_TTL_MS / 1000 },
} as const;
