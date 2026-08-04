import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { negotiateLocale } from "./negotiate";
import { isLocale, LOCALE_COOKIE } from "./routing";

/**
 * Resolves the active locale per request.
 *
 * Order of precedence:
 *   1. The `NEXT_LOCALE` cookie — an explicit choice the user made.
 *   2. The browser's `Accept-Language` header.
 *   3. English.
 *
 * The stored choice wins over the browser deliberately: someone who selected
 * English on a Spanish-configured machine meant it, and re-deciding from the
 * header on every request would keep overriding them.
 *
 * The cookie is untrusted input — it is user-editable — so it is validated
 * against the known locale list rather than used to build an import path. An
 * unrecognised value falls through to negotiation instead of failing the
 * request: a bad cookie must not be able to take the app down.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const chosen = store.get(LOCALE_COOKIE)?.value;

  const locale = isLocale(chosen)
    ? chosen
    : negotiateLocale((await headers()).get("accept-language"));

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
