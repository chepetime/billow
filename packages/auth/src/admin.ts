import "server-only";

import { redirect } from "next/navigation";

import { getSession } from "./session";

/**
 * The first account to register owns the installation and is given the `admin`
 * role (see the create hook in auth.ts). Administrative operations check
 * that role on the server; the UI only decides what to render.
 */
export function isAdmin(user: { role?: string | null } | undefined): boolean {
  return user?.role === "admin";
}

/** Server components: send non-admins away rather than rendering the page. */
export async function requireAdmin() {
  const session = await getSession();

  if (!session) redirect("/login");
  if (!isAdmin(session.user as { role?: string | null })) redirect("/settings");

  return session;
}

/** Route handlers: resolve the session and whether it may administer. */
export async function getAdminSession() {
  const session = await getSession();
  return {
    session,
    admin:
      Boolean(session) && isAdmin(session!.user as { role?: string | null }),
  };
}
