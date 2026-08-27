export interface ApiKeyRateLimit {
  /** Requests allowed per key within one window. */
  max: number;
  /** Window length in milliseconds — the unit BetterAuth's plugin expects. */
  windowMs: number;
}

export interface AuthEnv {
  baseUrl: string;
  secret: string;
  apiKeyRateLimit: ApiKeyRateLimit;
}

interface AuthEnvOptions {
  allowBuildFallback?: boolean;
}

const minimumSecretLength = 32;
const buildOnlySecret = "build-only-better-auth-placeholder";

/**
 * BetterAuth's api-key plugin defaults to 10 requests per 24 hours, which is a
 * budget for a key that gets used a handful of times a day, not for the thing
 * this API exists for: the account owner's own scripts and agents polling and
 * uploading against their own box. A key hits that ceiling during its first
 * few minutes of use and then reads as broken for the rest of the day.
 *
 * These are per-key limits on credential verification only. They are not what
 * protects the expensive routes — the vault and recovery-key handlers run
 * scrypt and carry their own tighter limiter (see lib/api/rate-limit.ts), and
 * that one does not care which credential the caller used. So this budget can
 * be generous without widening the memory-exhaustion window it exists to close.
 */
const defaultApiKeyRateLimitMax = 120;
const defaultApiKeyRateLimitWindowSeconds = 60;

/**
 * Anything unparseable falls back to the default rather than throwing. A typo
 * in an optional tuning knob must not stop the app from booting — an installer
 * whose auth layer refuses to start over a malformed number is unrecoverable
 * from the Umbrel UI, where there is no shell to fix it from.
 */
function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getAuthEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: AuthEnvOptions = {},
): AuthEnv {
  const secret =
    env.BETTER_AUTH_SECRET ||
    (options.allowBuildFallback ? buildOnlySecret : undefined);

  // BetterAuth always needs a valid base URL to construct internal URLs.
  // We never pin a public domain: real request origins are trusted
  // dynamically (see trustedOrigins in auth.ts), so this in-container default
  // is safe and works behind any proxy/host (umbrel.local / Tailscale /
  // Cloudflare / IP) without inference that can fail behind Umbrel's proxy.
  const baseUrl =
    env.BETTER_AUTH_URL ||
    env.NEXT_PUBLIC_APP_URL ||
    `http://localhost:${env.PORT || "3000"}`;

  if (!secret || secret.length < minimumSecretLength) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${minimumSecretLength} characters.`,
    );
  }

  return {
    baseUrl,
    secret,
    apiKeyRateLimit: {
      max: positiveInteger(
        env.BILLOW_API_KEY_RATE_LIMIT_MAX,
        defaultApiKeyRateLimitMax,
      ),
      windowMs:
        positiveInteger(
          env.BILLOW_API_KEY_RATE_LIMIT_WINDOW_SECONDS,
          defaultApiKeyRateLimitWindowSeconds,
        ) * 1000,
    },
  };
}
