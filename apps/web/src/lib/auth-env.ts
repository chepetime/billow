export interface AuthEnv {
  baseUrl: string;
  secret: string;
}

interface AuthEnvOptions {
  allowBuildFallback?: boolean;
}

const minimumSecretLength = 32;
const buildOnlySecret = "build-only-better-auth-placeholder";

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
  };
}
