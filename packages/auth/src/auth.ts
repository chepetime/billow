import "server-only";

import { apiKey } from "@better-auth/api-key";
import { getPrisma } from "@billow/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin, openAPI, twoFactor, username } from "better-auth/plugins";

import { getAuthEnv } from "./auth-env";
import {
  claimParkedDataKey,
  dataKeyCookies,
  dataKeyFromSessionKey,
  enrollUser,
  openSessionDataKey,
  parkDataKeyForTwoFactor,
  rewrapForNewPassword,
  unlockDataKey,
} from "./data-key";
import { deliverPasswordReset } from "./mailer";
import { canRegister } from "./registration";
import { getRegistrationEnabled } from "./registration-settings";
import { resolveTrustedOrigins } from "./trusted-origins";

const authEnv = getAuthEnv(process.env, {
  allowBuildFallback: process.env.NEXT_PHASE === "phase-production-build",
});

/**
 * Reads one of this app's own unsigned cookies off the request. better-auth's
 * cookie helpers are tuned for its signed session cookies; these are ours and
 * plain, so parsing the header directly avoids depending on that behaviour.
 */
function readCookie(headers: Headers | undefined, name: string): string | null {
  const header = headers?.get("cookie");
  if (!header) return null;

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(pair.slice(separator + 1).trim());
  }

  return null;
}

/**
 * Resolves the account a sign-in was for when no session was created, which is
 * what a pending second factor looks like. The credentials already verified by
 * this point, so this is a lookup rather than a check.
 */
async function userIdForSignIn(body: unknown): Promise<string | null> {
  const credentials = body as
    | { email?: unknown; username?: unknown }
    | undefined;
  const prisma = getPrisma();

  if (typeof credentials?.email === "string") {
    const user = await prisma.user.findUnique({
      where: { email: credentials.email },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  if (typeof credentials?.username === "string") {
    const user = await prisma.user.findUnique({
      where: { username: credentials.username },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  return null;
}

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
  // Storage is "database", backed by the RateLimit model.
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
    // Database storage, backed by the RateLimit model. Memory storage reset
    // every counter on restart, and this app restarts on every update — so the
    // brute-force window reopened on each deploy.
    storage: "database",
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
    // Every account's session is dropped when its password is reset, so a
    // reset triggered by someone who had stolen a session does not leave that
    // session alive afterwards.
    revokeSessionsOnPasswordReset: true,
    // Delivered by the email package when an administrator has configured a
    // provider; a no-op otherwise. The URL and token are never logged: anyone
    // able to read container logs could otherwise take over any account.
    sendResetPassword: async ({ user, url }, request) => {
      await deliverPasswordReset({ user, url, request });
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
  // Sign-in and sign-up are the only points in the request lifecycle where the
  // plaintext password exists, and so the only points where the data key can be
  // unwrapped. Everything downstream works from the session wrap instead.
  //
  // Every branch here is best-effort: a failure leaves the session without a
  // data key, which renders encrypted fields as unavailable. It must never
  // fail the sign-in itself — being unable to decrypt is recoverable, being
  // unable to authenticate is not.
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const path = ctx.path;
      const entersPassword =
        path === "/sign-up/email" ||
        path === "/sign-in/email" ||
        path === "/sign-in/username";
      const verifiesSecondFactor =
        path?.startsWith("/two-factor/verify") ?? false;
      const changesPassword = path === "/change-password";
      // Enabling or disabling two-factor rotates the session, and both take the
      // account password — so they can and must re-open the data key for the
      // session they leave behind. Missing them meant a toggle produced a
      // session with no wrap, which the restore gate read as a lockout and
      // "fixed" by rotating the user's recovery key.
      const togglesSecondFactor =
        path === "/two-factor/enable" || path === "/two-factor/disable";
      if (
        !entersPassword &&
        !verifiesSecondFactor &&
        !changesPassword &&
        !togglesSecondFactor
      ) {
        return;
      }

      const newSession = ctx.context.newSession;

      try {
        if (changesPassword) {
          // Without this the keyset stays sealed under the old password and
          // the user loses every encrypted field at their next sign-in.
          const session = ctx.context.session ?? newSession;
          const current = ctx.body?.currentPassword;
          const next = ctx.body?.newPassword;
          if (
            !session ||
            typeof current !== "string" ||
            typeof next !== "string"
          )
            return;

          const dataKey = await rewrapForNewPassword(
            session.user.id,
            current,
            next,
          );
          if (!dataKey) return;

          // `revokeOtherSessions` may have replaced the session this request
          // arrived on, so re-open whichever one it is leaving behind.
          const target = newSession ?? session;
          const sessionKey = await openSessionDataKey(
            session.user.id,
            target.session.id,
            dataKey,
          );
          ctx.setCookie(
            dataKeyCookies.name,
            sessionKey,
            dataKeyCookies.options,
          );
          return;
        }

        if (verifiesSecondFactor) {
          // The password was consumed at the sign-in step, so the data key is
          // wherever that step parked it.
          if (!newSession) return;
          const pendingKey = readCookie(
            ctx.headers,
            dataKeyCookies.pendingName,
          );

          // No parked key means this is enrolment, not sign-in: the user was
          // already signed in and is turning two-factor on. Their current
          // session still holds a usable data key, so carry it across to the
          // session this verification produces rather than leaving them unable
          // to decrypt until they next sign in.
          let dataKey = pendingKey
            ? await claimParkedDataKey(newSession.user.id, pendingKey)
            : null;

          if (!dataKey) {
            const existingKey = readCookie(ctx.headers, dataKeyCookies.name);
            const previous = ctx.context.session;
            if (existingKey && previous) {
              dataKey = await dataKeyFromSessionKey(
                newSession.user.id,
                previous.session.id,
                existingKey,
              );
            }
          }

          if (pendingKey) {
            ctx.setCookie(dataKeyCookies.pendingName, "", {
              ...dataKeyCookies.pendingOptions,
              maxAge: 0,
            });
          }
          if (!dataKey) return;

          const sessionKey = await openSessionDataKey(
            newSession.user.id,
            newSession.session.id,
            dataKey,
          );
          ctx.setCookie(
            dataKeyCookies.name,
            sessionKey,
            dataKeyCookies.options,
          );
          return;
        }

        const password =
          typeof ctx.body?.password === "string" ? ctx.body.password : null;
        if (!password) return;

        if (togglesSecondFactor) {
          const session = ctx.context.session ?? newSession;
          if (!session) return;

          const dataKey = await unlockDataKey(session.user.id, password);
          if (!dataKey) return;

          const target = newSession ?? session;
          const sessionKey = await openSessionDataKey(
            session.user.id,
            target.session.id,
            dataKey,
          );
          ctx.setCookie(
            dataKeyCookies.name,
            sessionKey,
            dataKeyCookies.options,
          );
          return;
        }

        if (path === "/sign-up/email") {
          if (!newSession) return;
          const dataKey = await enrollUser(newSession.user.id, password);
          const sessionKey = await openSessionDataKey(
            newSession.user.id,
            newSession.session.id,
            dataKey,
          );
          ctx.setCookie(
            dataKeyCookies.name,
            sessionKey,
            dataKeyCookies.options,
          );
          return;
        }

        // Sign-in.
        const userId = newSession?.user.id ?? (await userIdForSignIn(ctx.body));
        if (!userId) return;

        const dataKey = await unlockDataKey(userId, password);
        if (!dataKey) return;

        // Park unconditionally. `newSession` cannot be used to tell whether a
        // second factor is pending: BetterAuth populates it either way, and
        // when 2FA is required the session behind it is discarded before the
        // response is returned. Keying off it meant the wrap was written to a
        // session that ceased to exist, nothing was ever parked, and the real
        // session created by /two-factor/verify-* had no data key — which
        // signing in again could not fix, because it failed the same way.
        //
        // Parking costs one short-lived row and is claimed-and-deleted by the
        // verify step, so the redundant park on a password-only sign-in simply
        // expires.
        const pendingKey = await parkDataKeyForTwoFactor(userId, dataKey);
        ctx.setCookie(
          dataKeyCookies.pendingName,
          pendingKey,
          dataKeyCookies.pendingOptions,
        );

        if (!newSession) return;

        // Also open this session, which is the real one when no second factor
        // is required. When one is, BetterAuth discards this session and the
        // write lands on a row that disappears — harmless, and the park above
        // is what carries the key to /two-factor/verify-*.
        //
        // The park is deliberately not cleaned up here. There is no reliable
        // signal at this point for which of the two flows is in progress, and
        // guessing wrong strands the user with no data key and no way to fix
        // it by signing in again. An unclaimed park is one inert row that
        // expires in ten minutes; a wrong guess is a lockout.
        const sessionKey = await openSessionDataKey(
          userId,
          newSession.session.id,
          dataKey,
        );
        ctx.setCookie(dataKeyCookies.name, sessionKey, dataKeyCookies.options);
      } catch (error) {
        console.error("[auth] data key hook failed:", error);
      }
    }),
  },
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
