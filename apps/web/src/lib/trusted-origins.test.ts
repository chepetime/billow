import { describe, expect, it } from "vitest";

import { resolveTrustedOrigins } from "@/lib/trusted-origins";

describe("resolveTrustedOrigins", () => {
  it("derives an origin from Umbrel-style forwarded headers", () => {
    const headers = new Headers({
      "x-forwarded-host": "umbrel.local:46247",
      "x-forwarded-proto": "http",
    });

    expect(resolveTrustedOrigins(headers)).toEqual([
      "http://umbrel.local:46247",
    ]);
  });

  it("derives an origin from Cloudflare tunnel-style forwarded headers", () => {
    const headers = new Headers({
      "x-forwarded-host": "billow.example.com",
      "x-forwarded-proto": "https",
    });

    expect(resolveTrustedOrigins(headers)).toEqual([
      "https://billow.example.com",
    ]);
  });

  it("falls back to the plain host header when there is no x-forwarded-host", () => {
    const headers = new Headers({
      host: "localhost:3000",
    });

    expect(resolveTrustedOrigins(headers)).toEqual(["http://localhost:3000"]);
  });

  it("falls back to http when x-forwarded-proto is missing", () => {
    const headers = new Headers({
      "x-forwarded-host": "example.test",
    });

    expect(resolveTrustedOrigins(headers)).toEqual(["http://example.test"]);
  });

  it("returns an empty array when there is no host information at all", () => {
    const headers = new Headers();

    expect(resolveTrustedOrigins(headers)).toEqual([]);
  });

  it("merges in explicitly configured extra origins", () => {
    const headers = new Headers({
      "x-forwarded-host": "billow.example.com",
      "x-forwarded-proto": "https",
    });

    expect(
      resolveTrustedOrigins(
        headers,
        "https://extra.example.com, https://another.example.com",
      ),
    ).toEqual([
      "https://extra.example.com",
      "https://another.example.com",
      "https://billow.example.com",
    ]);
  });

  it("trims whitespace and drops empty entries from the configured list", () => {
    const headers = new Headers();

    expect(
      resolveTrustedOrigins(headers, "  https://extra.example.com , , "),
    ).toEqual(["https://extra.example.com"]);
  });

  it("de-duplicates origins that appear in both sources", () => {
    const headers = new Headers({
      "x-forwarded-host": "billow.example.com",
      "x-forwarded-proto": "https",
    });

    expect(
      resolveTrustedOrigins(headers, "https://billow.example.com"),
    ).toEqual(["https://billow.example.com"]);
  });

  it("never trusts the request's own Origin header", () => {
    const headers = new Headers({
      origin: "https://attacker.example",
      "x-forwarded-host": "billow.example.com",
      "x-forwarded-proto": "https",
    });

    const result = resolveTrustedOrigins(headers);

    expect(result).not.toContain("https://attacker.example");
    expect(result).toEqual(["https://billow.example.com"]);
  });

  it("returns nothing when there is no host and nothing configured", () => {
    const headers = new Headers({
      origin: "https://attacker.example",
    });

    expect(resolveTrustedOrigins(headers)).toEqual([]);
  });
});
