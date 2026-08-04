"use server";

import { cookies } from "next/headers";

import { isLocale, LOCALE_COOKIE } from "./routing";

/**
 * Persist an explicit language choice.
 *
 * A server action rather than `document.cookie` so the value is validated
 * before it is stored — the cookie is read back on every request, and the only
 * writer that should be able to put an arbitrary string in it is a user
 * editing it by hand, not this app.
 *
 * `httpOnly` is deliberately false: the value is a display preference, not a
 * credential, and keeping it readable lets the client render without a
 * round-trip if that is ever needed.
 */
export async function setLocale(value: string): Promise<void> {
  if (!isLocale(value)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, value, {
    path: "/",
    // An explicit year, not a session cookie: a session cookie would silently
    // reset the language every time the browser restarts, which reads as the
    // preference being ignored.
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
