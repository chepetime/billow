import { describe, expect, it } from "vitest";

import { negotiateLocale } from "./negotiate";

describe("negotiateLocale", () => {
  it("falls back to English when there is no header", () => {
    expect(negotiateLocale(null)).toBe("en");
    expect(negotiateLocale("")).toBe("en");
  });

  it("matches a regional tag to its primary language", () => {
    expect(negotiateLocale("es-MX")).toBe("es");
    expect(negotiateLocale("es-419,es;q=0.9")).toBe("es");
  });

  it("honours quality values over document order", () => {
    // The regression this exists for: reading left-to-right would pick English
    // here, even though the user ranked Spanish higher.
    expect(negotiateLocale("en;q=0.2, es;q=0.9")).toBe("es");
  });

  it("treats a missing q as 1.0, per the spec", () => {
    expect(negotiateLocale("en;q=0.2, es")).toBe("es");
  });

  it("ignores languages we do not support", () => {
    expect(negotiateLocale("de-DE,fr;q=0.8")).toBe("en");
    expect(negotiateLocale("de-DE,fr;q=0.8,es;q=0.1")).toBe("es");
  });

  it("skips a language explicitly refused with q=0", () => {
    expect(negotiateLocale("es;q=0, en;q=0.5")).toBe("en");
  });

  it("treats a wildcard as no preference", () => {
    expect(negotiateLocale("*")).toBe("en");
  });

  it("does not fall over on malformed input", () => {
    expect(negotiateLocale(",,;q=,")).toBe("en");
  });

  it("keeps a language whose quality value is unparseable", () => {
    // An unreadable q falls back to the spec default of 1.0 rather than
    // discarding the entry. The language itself was stated unambiguously, and
    // throwing it away over a malformed weight would silently serve English to
    // someone who asked for Spanish.
    expect(negotiateLocale("es;q=notanumber")).toBe("es");
  });
});
