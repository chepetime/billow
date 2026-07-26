import "server-only";

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, openAPI, twoFactor, username } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";

import { getAuthEnv } from "@/lib/auth-env";
import { canRegister } from "@/lib/registration";
import { getRegistrationEnabled } from "@/lib/registration-settings";
import { resolveTrustedOrigins } from "@/lib/trusted-origins";
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
    // There is no mail transport in this app, so a reset link can never
    // reach the requester anyway. Logging the working reset URL would let
    // anyone who can read container logs take over any account, so this
    // callback intentionally never logs (or otherwise exposes) the URL or
    // the token — only that a request happened, keyed by user id.
    // Administrators recover access instead via the admin plugin's
    // setUserPassword (Settings -> Users -> Set password).
    sendResetPassword: async ({ user }) => {
      console.info(
        `Password reset requested for user ${user.id}. Self-service reset is unavailable; an administrator must set a new password.`,
      );
    },
  },
  // Trust only the origin this request was actually served on, derived from
  // the reverse-proxy host headers (x-forwarded-host/x-forwarded-proto, with
  // a plain host/http fallback). This works behind any front door
  // (umbrel.local, Tailscale, Cloudflare, raw IP) without pinning
  // BETTER_AUTH_URL to a domain.
  //
  // This never reads the request's Origin header: doing so previously made
  // trustedOrigins tautological (an attacker's own Origin validated itself),
  // which defeated BetterAuth's cross-site (CSRF) check entirely. Production
  // diagnostics confirmed x-forwarded-host/x-forwarded-proto do arrive intact
  // through both Umbrel's app_proxy and a Cloudflare tunnel, so a genuine
  // cross-site POST is now rejected. BILLOW_TRUSTED_ORIGINS (comma-separated)
  // remains as an escape hatch for unusual deployments.
  trustedOrigins: async (request) => {
    if (!request) {
      return [];
    }

    return resolveTrustedOrigins(
      request.headers,
      process.env.BILLOW_TRUSTED_ORIGINS,
    );
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
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
    // Keep auth's generated specification available without its CDN-hosted UI.
    openAPI({ disableDefaultReference: true }),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async () => {
          const prisma = getPrisma();
          const [userCount, registrationEnabled] = await Promise.all([
            prisma.user.count(),
            getRegistrationEnabled(),
          ]);
          if (!canRegister(userCount, registrationEnabled)) {
            throw new APIError("FORBIDDEN", {
              message: "Registration is closed.",
            });
          }
        },
        after: async (user) => {
          // The first account owns the installation and administers it.
          const prisma0 = getPrisma();
          if ((await prisma0.user.count()) === 1) {
            await prisma0.user.update({
              where: { id: user.id },
              data: { role: "admin" },
            });
          }
          // A pre-auth installation can contain seeded workspace data. Assign
          // that unclaimed data to the first account exactly once.
          const prisma = getPrisma();
          const userCount = await prisma.user.count();
          if (userCount !== 1) return;

          await prisma.$transaction([
            prisma.userProfile.updateMany({
              where: { userId: null },
              data: { userId: user.id },
            }),
            prisma.clientCompany.updateMany({
              where: { userId: null },
              data: { userId: user.id },
            }),
            prisma.invoice.updateMany({
              where: { userId: null },
              data: { userId: user.id },
            }),
          ]);
        },
      },
    },
  },
});
