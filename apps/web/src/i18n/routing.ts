/**
 * Locale configuration, kept free of server-only imports so both the request
 * config and client components (the language picker) can read it.
 *
 * Cookie-based rather than URL-prefixed (`/es/settings`). This app is reached
 * at whatever host the operator's Umbrel exposes, is single-user in practice,
 * and has no SEO surface to gain from per-locale URLs — while a prefix would
 * change every route, every redirect in middleware, and the trusted-origin
 * handling. The cookie is the smaller change for the same result.
 */

export const LOCALES = ["en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Read by both the server (request config) and the picker that sets it. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}
