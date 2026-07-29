import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./auth";
import { authRegistry } from "./registry";

export type AuthErrorReporter = (
  context: string,
  error: unknown,
) => void | Promise<void>;

// This package deliberately has no persistence/error-logging dependency of
// its own (that lives in the host app, alongside its own database models).
// The host app plugs its reporter in once at startup via
// `setAuthErrorReporter`; until it does, failures are still visible via
// `console.error` below, matching the behavior before this seam existed.
//
// Held on globalThis, not in module scope — see ./registry for why a plain
// module-level variable silently loses the registration.

/** Lets the host app observe auth failures without this package depending on it. */
export function setAuthErrorReporter(reporter: AuthErrorReporter): void {
  authRegistry().errorReporter = reporter;
}

export async function getSession() {
  try {
    return await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    // Never let an auth hiccup take down a whole page render; treat it as
    // signed-out and persist the real cause (retrievable at /api/health).
    console.error("[auth] getSession failed:", error);
    await authRegistry().errorReporter?.("getSession", error);
    return null;
  }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function requireGuest() {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }
}
