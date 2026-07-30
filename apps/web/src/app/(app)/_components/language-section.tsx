"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@billow/shadcn/components/button";
import { setLocale } from "@/i18n/actions";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  type Locale,
} from "@/i18n/routing";

/**
 * Language picker.
 *
 * The locale lives in a cookie rather than the URL or the database: it is a
 * per-browser display preference, and keeping it out of the database means it
 * works on the sign-in page, before there is a session to store it against.
 *
 * `router.refresh()` rather than a reload — the locale is resolved on the
 * server, so re-rendering the tree from the server is what applies it, and it
 * keeps scroll position and client state.
 */
export function LanguageSection() {
  const t = useTranslations("common");
  const active = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function choose(locale: Locale) {
    startTransition(async () => {
      await setLocale(locale);
      // The locale is resolved on the server, so re-rendering from the server
      // is what applies it — no reload, so scroll and client state survive.
      router.refresh();
    });
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold">{t("language")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("languageDescription")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {LOCALES.map((locale) => (
          <Button
            key={locale}
            type="button"
            variant={locale === active ? "default" : "outline"}
            disabled={isPending}
            aria-pressed={locale === active}
            onClick={() => choose(locale)}
          >
            {LOCALE_LABELS[locale] ?? LOCALE_LABELS[DEFAULT_LOCALE]}
          </Button>
        ))}
      </div>
    </section>
  );
}
