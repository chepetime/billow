import "server-only";

import {
  beginSession,
  changePassword,
  createUserKeyset,
  issueRecoveryKey,
  KeyHierarchyError,
  resetPasswordWithRecoveryKey,
  resumeSession,
  type UserKeyset,
  unlockWithPassword,
  unlockWithRecoveryKey,
} from "@billow/crypto";
import { getPrisma } from "@billow/db";
import { backfillEncryptedFields } from "@billow/db/field-encryption";
import { cookies } from "next/headers";

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

/**
 * Matches better-auth's own session lifetime (7 days). Without a maxAge this
 * is a browser-session cookie while the session cookie beside it is
 * persistent, so closing the browser leaves the user signed in with no data
 * key — and the restore gate then reads that as a locked-out account and
 * demands their recovery key on every browser restart.
 */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;

function pendingIdentifier(userId: string) {
  return `data-key-pending:${userId}`;
}

function orphanIdentifier(userId: string) {
  return `keyset-orphaned:${userId}`;
}

// A year. This is a latch, not a timer: it is set when sign-in proves the
// keyset cannot be opened and cleared when something proves otherwise.
const ORPHAN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Records that sign-in could not open the keyset with the account password.
 *
 * This is the *positive* signal that an account is locked out of its own data.
 * The absence of a session wrap is not — a session created by any endpoint the
 * data-key hook does not cover has no wrap either, and reading that as a
 * lockout sent people to hand over their recovery key after merely toggling
 * two-factor, which then rotated the key they had just saved.
 */
async function markKeysetOrphaned(userId: string): Promise<void> {
  const prisma = getPrisma();
  const identifier = orphanIdentifier(userId);
  const existing = await prisma.verification.findFirst({
    where: { identifier },
  });
  if (existing) return;

  await prisma.verification.create({
    data: {
      identifier,
      value: "1",
      expiresAt: new Date(Date.now() + ORPHAN_TTL_MS),
    },
  });
}

/** Clears the latch once the keyset opens again. */
async function clearKeysetOrphaned(userId: string): Promise<void> {
  await getPrisma().verification.deleteMany({
    where: { identifier: orphanIdentifier(userId) },
  });
}

/** Mints a keyset for a brand-new account. The recovery arm comes later. */
export async function enrollUser(
  userId: string,
  password: string,
): Promise<Buffer> {
  const { keyset, dataKey } = await createUserKeyset(userId, password);

  await getPrisma().userKeyset.create({ data: { userId, ...keyset } });

  return dataKey;
}

/**
 * Unwraps the data key with the password. Returns null when the account has no
 * keyset — every account created before this shipped is in that state, and
 * they must keep being able to sign in.
 */
export async function unlockDataKey(
  userId: string,
  password: string,
): Promise<Buffer | null> {
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
      const raced = await getPrisma().userKeyset.findUnique({
        where: { userId },
      });
      if (!raced) return null;
      return await unlockWithPassword(
        userId,
        raced as UserKeyset,
        password,
      ).catch(() => null);
    }
  }

  try {
    const dataKey = await unlockWithPassword(
      userId,
      stored as UserKeyset,
      password,
    );
    // Opening it is proof the account is not locked out, whatever an earlier
    // failure may have latched.
    await clearKeysetOrphaned(userId);
    return dataKey;
  } catch (error) {
    // The password already authenticated, so a failure here means the keyset is
    // sealed under a password nobody holds — a reset, or an administrator
    // setting one directly. Latch it: this is the only moment that fact is
    // knowable, and the recovery flow needs to know it later.
    if (error instanceof KeyHierarchyError) {
      await markKeysetOrphaned(userId);
      return null;
    }
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
  const { sessionKey, dataKeyWrappedBySessionKey } = await beginSession(
    userId,
    dataKey,
  );

  await getPrisma().session.update({
    where: { id: sessionId },
    data: { dataKeyWrappedBySessionKey },
  });

  // Rows written before encryption shipped can only be sealed while their
  // owner is signed in — the server holds no data keys otherwise — so this is
  // the one moment it can happen. Never allowed to fail the sign-in: the
  // fields stay plaintext and the next sign-in tries again.
  try {
    await backfillEncryptedFields(userId, dataKey);
  } catch (error) {
    console.error("[auth] encrypted-field backfill failed:", error);
  }

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
  const { sessionKey, dataKeyWrappedBySessionKey } = await beginSession(
    userId,
    dataKey,
  );
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
 * The data key for a session, given the cookie value explicitly.
 *
 * Separate from `getDataKey` because BetterAuth hooks cannot read cookies
 * through `next/headers` — they only have the request they were handed.
 */
export async function dataKeyFromSessionKey(
  userId: string,
  sessionId: string,
  sessionKey: string,
): Promise<Buffer | null> {
  const session = await getPrisma().session.findUnique({
    where: { id: sessionId },
    select: { dataKeyWrappedBySessionKey: true },
  });
  if (!session?.dataKeyWrappedBySessionKey) return null;

  try {
    return await resumeSession(
      userId,
      session.dataKeyWrappedBySessionKey,
      sessionKey,
    );
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
export async function getDataKey(
  userId: string,
  sessionId: string,
): Promise<Buffer | null> {
  const sessionKey = (await cookies()).get(DATA_KEY_COOKIE)?.value;
  if (!sessionKey) return null;

  const session = await getPrisma().session.findUnique({
    where: { id: sessionId },
    select: { dataKeyWrappedBySessionKey: true },
  });
  if (!session?.dataKeyWrappedBySessionKey) return null;

  try {
    return await resumeSession(
      userId,
      session.dataKeyWrappedBySessionKey,
      sessionKey,
    );
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
  /** Whether this request can actually reach the data key right now. */
  dataKeyAvailable: boolean;
  /**
   * Whether sign-in has proven the account password can no longer open the
   * keyset. This is the orphan signal — a latched fact, not an inference.
   */
  keysetOrphaned: boolean;
  /**
   * Whether sign-in managed to wrap a data key for this session. Useful for
   * telling a user their browser simply needs to sign in again; NOT a lockout
   * signal, because any endpoint the hook does not cover leaves it false.
   * Reading it as one rotated recovery keys on a two-factor toggle.
   */
  sessionHasDataKeyWrap: boolean;
};

/** True when the user still owes us a confirmed, working recovery key. */
export function needsRecoveryKey(state: RecoveryKeyState | null): boolean {
  if (!state?.hasKeyset) return false;
  return !state.hasRecoveryArm || !state.savedAt;
}

/**
 * True when the account has a keyset that its own password no longer opens.
 *
 * A password *reset* cannot re-wrap the data key — there is no current
 * password to unwrap it with — so the keyset is left sealed under a password
 * nobody knows. The same is true of an administrator setting a password
 * directly. Rather than patch each of those paths, this detects the state they
 * all produce and routes the user to the one flow that can undo it.
 *
 * Requires a cookie session: an API-key caller legitimately has no data key
 * and must not be told its account is broken.
 */
export function needsAccessRestored(state: RecoveryKeyState | null): boolean {
  if (!state?.hasKeyset || !state.hasRecoveryArm) return false;
  // Only a proven lockout. A session without a wrap is usually just a session
  // the hook never saw — signing in again fixes that, and asking for a
  // recovery key would be both alarming and destructive.
  return state.keysetOrphaned;
}

/**
 * Puts a locked-out account back together: unwrap the data key with the
 * recovery key, re-wrap it under the password the user now has, and re-open
 * the session.
 *
 * Takes the password as well as the recovery key because re-wrapping needs
 * both, and by the time the user reaches this page their sign-in password is
 * long out of scope. Asking again is also the right shape for the operation —
 * it is the one that hands back every encrypted field they own.
 */
export async function restoreAccessWithRecoveryKey(
  userId: string,
  sessionId: string,
  recoveryKey: string,
  password: string,
  verifyPassword: (password: string) => Promise<boolean>,
): Promise<string | null> {
  const prisma = getPrisma();
  const stored = await prisma.userKeyset.findUnique({ where: { userId } });
  if (!stored) return null;

  // The password must be checked against the account before anything is
  // re-wrapped. `resetPasswordWithRecoveryKey` re-wraps under whatever it is
  // given and cannot tell a real password from a typo — so without this, a
  // mistyped password would seal the data key under a password the account
  // does not have, locking it a second time and looking like success.
  if (!(await verifyPassword(password))) return null;

  let keyset: UserKeyset;
  try {
    keyset = await resetPasswordWithRecoveryKey(
      userId,
      stored as UserKeyset,
      recoveryKey,
      password,
    );
  } catch (error) {
    if (error instanceof KeyHierarchyError) return null;
    throw error;
  }

  await prisma.$transaction([
    prisma.userKeyset.update({
      where: { userId },
      data: {
        passwordSalt: keyset.passwordSalt,
        dataKeyWrappedByPassword: keyset.dataKeyWrappedByPassword,
      },
    }),
    // The recovery key has now been typed into a form, possibly on a machine
    // that is not theirs, to rescue an account that was already in trouble.
    // Clearing the confirmation sends them back through onboarding for a fresh
    // one, so a key that has been spent is never also the key still on file.
    prisma.userOnboarding.upsert({
      where: { userId },
      create: { userId },
      update: { recoveryKeySavedAt: null },
    }),
  ]);

  await clearKeysetOrphaned(userId);

  const dataKey = await unlockWithPassword(userId, keyset, password);
  return await openSessionDataKey(userId, sessionId, dataKey);
}

export async function getRecoveryKeyState(
  userId: string,
  sessionId?: string,
): Promise<RecoveryKeyState> {
  const prisma = getPrisma();
  const [keyset, onboarding, dataKey, session, orphaned] = await Promise.all([
    prisma.userKeyset.findUnique({
      where: { userId },
      select: { recoverySalt: true },
    }),
    prisma.userOnboarding.findUnique({ where: { userId } }),
    sessionId ? getDataKey(userId, sessionId) : Promise.resolve(null),
    sessionId
      ? prisma.session.findUnique({
          where: { id: sessionId },
          select: { dataKeyWrappedBySessionKey: true },
        })
      : Promise.resolve(null),
    prisma.verification.findFirst({
      where: { identifier: orphanIdentifier(userId) },
    }),
  ]);

  return {
    hasKeyset: Boolean(keyset),
    hasRecoveryArm: Boolean(keyset?.recoverySalt),
    generatedAt: onboarding?.recoveryKeyGeneratedAt ?? null,
    savedAt: onboarding?.recoveryKeySavedAt ?? null,
    dataKeyAvailable: Boolean(dataKey),
    sessionHasDataKeyWrap: Boolean(session?.dataKeyWrappedBySessionKey),
    keysetOrphaned: Boolean(orphaned),
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

  const { keyset, recoveryKey } = await issueRecoveryKey(
    userId,
    stored as UserKeyset,
    dataKey,
  );
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
    create: {
      userId,
      recoveryKeyGeneratedAt: new Date(),
      recoveryKeySavedAt: new Date(),
    },
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
