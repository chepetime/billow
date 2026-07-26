import "server-only";

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, openAPI, twoFactor, username } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";

import { getPrisma } from "@billow/db";

import { getAuthEnv } from "./auth-env";
import { canRegister } from "./registration";
import { getRegistrationEnabled } from "./registration-settings";
import { resolveTrustedOrigins } from "./trusted-origins";

const authEnv = getAuthEnv(process.env, {
  allowBuildFallback: process.env.NEXT_PHASE === "phase-production-build",
});

export const auth = betterAuth({
  baseURL: authEnv.baseUrl,
  secret: authEnv.secret,
  database: prismaAdapter(getPrisma(), {
    provider: "postgresql",
  }),
  // Explicit, not the framework default: BetterAuth only enables rate
  // limiting in production unless told otherwise, which makes the
  // protection invisible here and dependent on NODE_ENV. `enabled: true`
  // pins it on regardless of environment.
  //
  // Storage: "memory" (the BetterAuth default). BetterAuth's "database"
  // storage needs its own `rateLimit` model (key/count/lastRequest) behind
  // the Prisma adapter, and packages/db/prisma/schema.prisma has no such
  // model — adding one means a new model plus a migration, which is out of
  // scope here. This app runs as a single container/process, so an
  // in-memory bucket is a correct enforcement point; the tradeoff is that
  // every counter resets on restart/redeploy, briefly re-opening the window
  // for an attacker who times it around a deploy.
  //
  // `window`/`max` below are the general limit for every other endpoint.
  // `customRules` tightens the specific brute-force targets: sign-in (email
  // and username, both under /sign-in/*), two-factor verification (TOTP,
  // OTP, backup code — all under /two-factor/*), and password-reset
  // requests. Writing these out explicitly documents the policy here
  // instead of leaning on BetterAuth's own built-in special-cases (which
  // exist but are undocumented in this file and would silently change
  // behind a framework upgrade).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-in/username": { window: 60, max: 5 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-otp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 5 },
    },
  },
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
