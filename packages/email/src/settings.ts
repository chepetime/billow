import "server-only";

import { getPrisma } from "@billow/db";

import {
  EMAIL_CAPABILITY_UNKNOWN,
  resolveEmailCapability,
  type EmailCapability,
} from "./capability";
import {
  CredentialCryptoError,
  decryptCredential,
  encryptCredential,
  previewCredential,
} from "./crypto";
import { isSupportedProvider, type ProviderName } from "./provider";

/**
 * What a client is allowed to see. The API key is absent by construction —
 * this type has no field that could hold it — so no route can leak the
 * credential by forgetting to strip it.
 */
export interface PublicEmailSettings {
  provider: ProviderName;
  configured: boolean;
  apiKeyHint: string | null;
  fromEmail: string | null;
  fromName: string | null;
  publicUrl: string | null;
  verifiedAt: string | null;
  updatedAt: string | null;
  /** Set when a key is stored but unreadable, e.g. BETTER_AUTH_SECRET rotated. */
  credentialError: string | null;
  capability: EmailCapability;
}

export interface EmailSettingsUpdate {
  apiKey?: string | undefined;
  fromEmail?: string | undefined;
  fromName?: string | undefined;
  publicUrl?: string | undefined;
  updatedById?: string | undefined;
}

const SETTINGS_ID = 1;

/**
 * Deliberately permissive: matches `local@domain.tld` shapes without trying
 * to be a full RFC 5322 parser. The provider is the real authority on whether
 * an address is deliverable, and the test-send button surfaces its verdict.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

/**
 * Resend requires either `you@domain` or `Name <you@domain>`. Built here so
 * the display name cannot inject a second header: anything outside a
 * conservative character set is dropped rather than escaped.
 */
export function formatFromAddress(
  email: string,
  name: string | null,
): string {
  const safeName = (name ?? "").replace(/[^\p{L}\p{N} .'-]/gu, "").trim();
  return safeName ? `${safeName} <${email}>` : email;
}

export async function getPublicEmailSettings(): Promise<PublicEmailSettings> {
  const row = await getPrisma().emailSettings.findUnique({
    where: { id: SETTINGS_ID },
  });

  const provider = isSupportedProvider(row?.provider)
    ? row.provider
    : "resend";

  if (!row?.apiKey) {
    return {
      provider,
      configured: false,
      apiKeyHint: null,
      fromEmail: row?.fromEmail ?? null,
      fromName: row?.fromName ?? null,
      publicUrl: row?.publicUrl ?? null,
      verifiedAt: null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      credentialError: null,
      capability: resolveEmailCapability({
        configured: false,
        fromEmail: row?.fromEmail ?? null,
        verifiedAt: null,
      }),
    };
  }

  // A stored key that will not decrypt must be reported, not hidden: the
  // install looks configured but every send would fail.
  let credentialError: string | null = null;
  try {
    decryptCredential(row.apiKey);
  } catch (error) {
    credentialError =
      error instanceof CredentialCryptoError
        ? error.message
        : "Stored credential could not be read.";
  }

  return {
    provider,
    configured: credentialError === null,
    apiKeyHint: row.apiKeyHint,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    publicUrl: row.publicUrl,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    credentialError,
    capability: resolveEmailCapability({
      configured: credentialError === null,
      fromEmail: row.fromEmail,
      verifiedAt: row.verifiedAt,
    }),
  };
}

/**
 * The one call user-facing features should make. Reads a single row and fails
 * closed, so a database problem hides the feature rather than advertising one
 * that cannot work.
 */
export async function getEmailCapability(): Promise<EmailCapability> {
  try {
    const row = await getPrisma().emailSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { apiKey: true, fromEmail: true, verifiedAt: true },
    });

    if (!row?.apiKey) {
      return resolveEmailCapability({
        configured: false,
        fromEmail: row?.fromEmail ?? null,
        verifiedAt: null,
      });
    }

    // Decryptability is part of being configured: a key that cannot be read
    // (BETTER_AUTH_SECRET rotated) would fail on every send.
    let readable = true;
    try {
      decryptCredential(row.apiKey);
    } catch {
      readable = false;
    }

    return resolveEmailCapability({
      configured: readable,
      fromEmail: row.fromEmail,
      verifiedAt: row.verifiedAt,
    });
  } catch {
    return EMAIL_CAPABILITY_UNKNOWN;
  }
}

/** Records that a send genuinely worked. Called only after a provider success. */
export async function markEmailVerified(): Promise<void> {
  await getPrisma().emailSettings.update({
    where: { id: SETTINGS_ID },
    data: { verifiedAt: new Date() },
  });
}

/**
 * Withdraws verification after a live send fails, so the feature hides itself
 * when email breaks rather than continuing to promise delivery. Deliberately
 * swallows its own errors: it runs on a failure path where there is nothing
 * useful to do with a second one.
 */
export async function clearEmailVerification(): Promise<void> {
  try {
    await getPrisma().emailSettings.update({
      where: { id: SETTINGS_ID },
      data: { verifiedAt: null },
    });
  } catch {
    // Ignored on purpose.
  }
}

/** The operator-pinned canonical origin for links in emails, if any. */
export async function getConfiguredPublicUrl(): Promise<string | null> {
  const row = await getPrisma().emailSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { publicUrl: true },
  });
  return row?.publicUrl ?? null;
}

/**
 * Reads the decrypted key for actually sending. Server-side only, and the
 * result must never reach a response body.
 */
export async function getSendingCredentials(): Promise<
  { apiKey: string; from: string } | null
> {
  const row = await getPrisma().emailSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (!row?.apiKey || !row.fromEmail) return null;

  try {
    return {
      apiKey: decryptCredential(row.apiKey),
      from: formatFromAddress(row.fromEmail, row.fromName),
    };
  } catch {
    return null;
  }
}

/**
 * Partial update. An omitted `apiKey` leaves the stored credential alone, so
 * an administrator can change the from-address without re-entering the key;
 * an empty string clears it.
 */
export async function updateEmailSettings(
  update: EmailSettingsUpdate,
): Promise<PublicEmailSettings> {
  const data: {
    apiKey?: string | null;
    apiKeyHint?: string | null;
    fromEmail?: string;
    fromName?: string | null;
    publicUrl?: string | null;
    verifiedAt?: Date | null;
    updatedById?: string | null;
  } = {};

  if (update.apiKey !== undefined) {
    if (update.apiKey === "") {
      data.apiKey = null;
      data.apiKeyHint = null;
    } else {
      data.apiKey = encryptCredential(update.apiKey);
      data.apiKeyHint = previewCredential(update.apiKey);
    }
  }

  if (update.fromEmail !== undefined) data.fromEmail = update.fromEmail;
  if (update.fromName !== undefined) data.fromName = update.fromName || null;
  if (update.publicUrl !== undefined) data.publicUrl = update.publicUrl || null;
  if (update.updatedById !== undefined) {
    data.updatedById = update.updatedById ?? null;
  }

  // Changing the credential or the sender invalidates the previous proof of
  // delivery: it says a *different* configuration once worked. The sender name
  // and public URL are cosmetic by comparison and do not affect deliverability,
  // so they leave the verification intact.
  if (data.apiKey !== undefined || data.fromEmail !== undefined) {
    data.verifiedAt = null;
  }

  await getPrisma().emailSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, provider: "resend", ...data },
    update: data,
  });

  return getPublicEmailSettings();
}
