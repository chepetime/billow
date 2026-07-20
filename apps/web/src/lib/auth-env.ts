export interface AuthEnv {
  baseUrl: string;
  secret: string;
}

interface AuthEnvOptions {
  allowBuildFallback?: boolean;
}

const minimumSecretLength = 32;
const buildOnlySecret = "build-only-better-auth-placeholder";
const buildOnlyBaseUrl = "http://localhost:3000";

export function getAuthEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: AuthEnvOptions = {},
): AuthEnv {
  const secret =
    env.BETTER_AUTH_SECRET ||
    (options.allowBuildFallback ? buildOnlySecret : undefined);
  const baseUrl =
    env.BETTER_AUTH_URL ||
    env.NEXT_PUBLIC_APP_URL ||
    (options.allowBuildFallback ? buildOnlyBaseUrl : undefined);

  if (!secret || secret.length < minimumSecretLength) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${minimumSecretLength} characters.`,
    );
  }

  if (!baseUrl) {
    throw new Error("BETTER_AUTH_URL is required.");
  }

  return {
    baseUrl,
    secret,
  };
}
