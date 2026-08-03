import "server-only";

import { cookies } from "next/headers";

import {
  KeyHierarchyError,
  beginSession,
  changePassword,
  createUserKeyset,
  issueRecoveryKey,
  resumeSession,
  unlockWithPassword,
  unlockWithRecoveryKey,
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
  if (!stored) {
    // Backfill. An account created before the keyset existed has none, and
    // sign-in is the only moment its password is in scope — so it is the only
    // moment one can be minted. Doing it here means every existing account
    // acquires a keyset by simply signing in, with no migration and nothing
    // for the user to do.
    try {
      return await enrollUser(userId, password);
    } catch {
      // Two concurrent sign-ins race for the same unique userId. Whichever
      // lost re-reads the winner's row rather than failing the sign-in.
      const raced = await getPrisma().userKeyset.findUnique({ where: { userId } });
      if (!raced) return null;
      return await unlockWithPassword(userId, raced as UserKeyset, password).catch(() => null);
    }
  }

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

export type RecoveryKeyState = {
  /** False for an account that has never signed in since keysets existed. */
  hasKeyset: boolean;
  /**
   * Whether a recovery key currently exists. Read from the keyset itself
   * rather than inferred from `savedAt`, because that flag is bookkeeping and
   * this is the fact: a keyset with no recovery arm cannot be recovered no
   * matter what any timestamp claims.
   */
  hasRecoveryArm: boolean;
  generatedAt: Date | null;
  savedAt: Date | null;
};

/** True when the user still owes us a confirmed, working recovery key. */
export function needsRecoveryKey(state: RecoveryKeyState | null): boolean {
  if (!state?.hasKeyset) return false;
  return !state.hasRecoveryArm || !state.savedAt;
}

export async function getRecoveryKeyState(userId: string): Promise<RecoveryKeyState> {
  const prisma = getPrisma();
  const [keyset, onboarding] = await Promise.all([
    prisma.userKeyset.findUnique({ where: { userId }, select: { recoverySalt: true } }),
    prisma.userOnboarding.findUnique({ where: { userId } }),
  ]);

  return {
    hasKeyset: Boolean(keyset),
    hasRecoveryArm: Boolean(keyset?.recoverySalt),
    generatedAt: onboarding?.recoveryKeyGeneratedAt ?? null,
    savedAt: onboarding?.recoveryKeySavedAt ?? null,
  };
}

/**
 * Mints a recovery key and returns it — the only time it is ever knowable.
 * Replaces any previous one, so a user who abandoned the flow can start again;
 * that also clears `recoveryKeySavedAt`, because a confirmation refers to the
 * key that was confirmed and means nothing about its replacement.
 */
export async function issueRecoveryKeyFor(
  userId: string,
  dataKey: Buffer,
): Promise<string | null> {
  const prisma = getPrisma();
  const stored = await prisma.userKeyset.findUnique({ where: { userId } });
  if (!stored) return null;

  const { keyset, recoveryKey } = await issueRecoveryKey(userId, stored as UserKeyset, dataKey);
  const generatedAt = new Date();

  await prisma.$transaction([
    prisma.userKeyset.update({
      where: { userId },
      data: {
        recoverySalt: keyset.recoverySalt,
        dataKeyWrappedByRecoveryKey: keyset.dataKeyWrappedByRecoveryKey,
      },
    }),
    prisma.userOnboarding.upsert({
      where: { userId },
      create: { userId, recoveryKeyGeneratedAt: generatedAt },
      update: { recoveryKeyGeneratedAt: generatedAt, recoveryKeySavedAt: null },
    }),
  ]);

  return recoveryKey;
}

/**
 * Confirms the user actually holds the key, by using it.
 *
 * The whole key is required rather than a few groups of it. A partial check
 * would have to compare against something stored, and the one thing that must
 * never be stored is the recovery key — so "did they write it down" is only
 * answerable by watching the key do its job. Unwrapping the data key with it
 * proves possession and proves the key works, which a checkbox or a substring
 * comparison proves neither of.
 */
export async function confirmRecoveryKeySaved(
  userId: string,
  candidate: string,
): Promise<boolean> {
  const prisma = getPrisma();
  const stored = await prisma.userKeyset.findUnique({ where: { userId } });
  if (!stored) return false;

  try {
    await unlockWithRecoveryKey(userId, stored as UserKeyset, candidate);
  } catch (error) {
    if (error instanceof KeyHierarchyError) return false;
    throw error;
  }

  await prisma.userOnboarding.upsert({
    where: { userId },
    create: { userId, recoveryKeyGeneratedAt: new Date(), recoveryKeySavedAt: new Date() },
    update: { recoveryKeySavedAt: new Date() },
  });

  return true;
}

export const dataKeyCookies = {
  name: DATA_KEY_COOKIE,
  pendingName: PENDING_COOKIE,
  options: COOKIE_OPTIONS,
  pendingOptions: { ...COOKIE_OPTIONS, maxAge: PENDING_TTL_MS / 1000 },
} as const;
