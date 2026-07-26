import "server-only";

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { openAPI, twoFactor, username } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";

import { getAuthEnv } from "@/lib/auth-env";
import { getPrisma } from "@billow/db";

const authEnv = getAuthEnv(process.env, {
  allowBuildFallback: process.env.NEXT_PHASE === "phase-production-build",
});

export const auth = betterAuth({
  baseURL: authEnv.baseUrl,
  secret: authEnv.secret,
  database: prismaAdapter(getPrisma(), {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      console.info(
        `Password reset requested for ${user.email}. Reset URL: ${url}`,
      );
    },
  },
  // Trust the origin this request is actually served on so auth works behind
  // any front door (umbrel.local, Tailscale, Cloudflare, raw IP) without
  // pinning BETTER_AUTH_URL to a domain.
  //
  // Umbrel's app_proxy is known to drop X-Forwarded-* headers, so the
  // reverse-proxy host is unreliable. The browser's Origin header, however,
  // is a normal request header the proxy passes through verbatim, so we trust
  // it. Trade-off: this weakens BetterAuth's cross-site (CSRF) check, which is
  // acceptable for a single-user app that already sits behind Umbrel/Tailscale/
  // Cloudflare network auth. Sensitive mutations (password change) still
  // require the current password.
  trustedOrigins: async (request) => {
    if (!request) {
      return [];
    }

    const origins = new Set<string>();

    const origin = request.headers.get("origin");
    if (origin) {
      origins.add(origin);
    }

    const forwardedHost =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (forwardedHost) {
      const proto =
        request.headers.get("x-forwarded-proto") ??
        (request.url.startsWith("https") ? "https" : "http");
      origins.add(`${proto}://${forwardedHost}`);
    }

    return [...origins];
  },
  user: {
    changeEmail: {
      enabled: true,
      // There is no mail transport in this app, so addresses are never
      // verified. BetterAuth allows a direct update in exactly that case
      // (it still refuses once an address has been verified).
      updateEmailWithoutVerification: true,
    },
  },
  plugins: [
    username(),
    twoFactor(),
    apiKey(),
    // Keep auth's generated specification available without its CDN-hosted UI.
    openAPI({ disableDefaultReference: true }),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async () => {
          const userCount = await getPrisma().user.count();
          if (userCount >= 1) {
            throw new APIError("FORBIDDEN", {
              message: "Registration is closed.",
            });
          }
        },
      },
    },
  },
});
