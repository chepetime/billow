import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from "./routing";

/**
 * Pick the best supported locale from an `Accept-Language` header.
 *
 * Used only when the user has not made an explicit choice: a stored preference
 * always wins, because someone who picked English on a Spanish-configured
 * browser meant it.
 *
 * Matching is by primary subtag, so `es-MX`, `es-419` and `es` all resolve to
 * `es`. Quality values are honoured, and entries without one default to 1.0 as
 * the spec requires — without that, `en;q=0.2, es` would wrongly prefer
 * English purely because it appears first.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const quality = params
        .map((param) => /^\s*q=([0-9.]+)\s*$/.exec(param))
        .find(Boolean)?.[1];

      return {
        tag: (tag ?? "").trim().toLowerCase(),
        quality: quality === undefined ? 1 : Number.parseFloat(quality),
      };
    })
    .filter((entry) => entry.tag.length > 0 && Number.isFinite(entry.quality))
    // q=0 means "explicitly not acceptable", so it is dropped rather than
    // merely ranked last.
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const entry of ranked) {
    if (entry.tag === "*") return DEFAULT_LOCALE;

    const primary = entry.tag.split("-")[0] ?? "";
    if (isLocale(primary)) return primary;
    // Exact match on a tag we happen to support verbatim.
    if (isLocale(entry.tag)) return entry.tag;
  }

  return DEFAULT_LOCALE;
}

export const SUPPORTED_LOCALES = LOCALES;
