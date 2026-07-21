import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { recordError } from "@/lib/error-log";

export async function getSession() {
  try {
    return await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    // Never let an auth hiccup take down a whole page render; treat it as
    // signed-out and persist the real cause (retrievable at /api/health).
    console.error("[auth] getSession failed:", error);
    await recordError("getSession", error);
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
