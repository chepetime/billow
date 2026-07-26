import { describe, expect, it } from "vitest";

import {
  normalizePublicUrl,
  originFromHeaders,
  resolveEmailOrigin,
  rewriteOrigin,
} from "./public-url";

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("normalizePublicUrl", () => {
  it("reduces a URL to its origin", () => {
    expect(normalizePublicUrl("https://billow.example/some/path?x=1")).toBe(
      "https://billow.example",
    );
  });

  it("keeps a non-default port", () => {
    expect(normalizePublicUrl("http://umbrel.local:46247")).toBe(
      "http://umbrel.local:46247",
    );
  });

  it.each([
    ["http://localhost:3000", "localhost"],
    ["http://127.0.0.1:3000", "loopback IPv4"],
    ["http://[::1]:3000", "loopback IPv6"],
    ["http://0.0.0.0:3000", "unspecified address"],
  ])("rejects %s (%s) — dead in an inbox", (url) => {
    expect(normalizePublicUrl(url)).toBeNull();
  });

  it.each([
    ["javascript:alert(1)", "javascript scheme"],
    ["data:text/html,x", "data scheme"],
    ["ftp://example.com", "non-http scheme"],
    ["not a url", "unparseable"],
    ["", "empty"],
  ])("rejects %s (%s)", (url) => {
    expect(normalizePublicUrl(url)).toBeNull();
  });
});

describe("originFromHeaders", () => {
  it("prefers the forwarded host and proto", () => {
    expect(
      originFromHeaders(
        headers({
          "x-forwarded-host": "billow.example",
          "x-forwarded-proto": "https",
          host: "localhost:3000",
        }),
      ),
    ).toBe("https://billow.example");
  });

  it("falls back to host with http", () => {
    expect(originFromHeaders(headers({ host: "umbrel.local:46247" }))).toBe(
      "http://umbrel.local:46247",
    );
  });

  it("returns null for a loopback host", () => {
    // The in-container default. Producing a link here is the exact bug this
    // module exists to prevent.
    expect(originFromHeaders(headers({ host: "localhost:3000" }))).toBeNull();
  });

  it("rejects an unexpected proto", () => {
    expect(
      originFromHeaders(
        headers({ host: "billow.example", "x-forwarded-proto": "javascript" }),
      ),
    ).toBeNull();
  });

  it("returns null when no host header is present", () => {
    expect(originFromHeaders(headers({}))).toBeNull();
  });
});

describe("resolveEmailOrigin", () => {
  it("prefers a configured public URL over the request", () => {
    expect(
      resolveEmailOrigin(
        "https://canonical.example",
        headers({ host: "other.example" }),
      ),
    ).toBe("https://canonical.example");
  });

  it("falls back to the request origin when unconfigured", () => {
    expect(resolveEmailOrigin(null, headers({ host: "billow.example" }))).toBe(
      "http://billow.example",
    );
  });

  it("falls back to the request when the configured URL is unusable", () => {
    expect(
      resolveEmailOrigin("http://localhost:3000", headers({ host: "b.example" })),
    ).toBe("http://b.example");
  });

  it("returns null when neither source yields a reachable origin", () => {
    // Callers must not send: a reset email whose link is dead spends the
    // token and leaves the user believing recovery is underway.
    expect(resolveEmailOrigin(null, headers({ host: "localhost" }))).toBeNull();
    expect(resolveEmailOrigin(null, null)).toBeNull();
  });
});

describe("rewriteOrigin", () => {
  it("re-points a localhost link at the reachable origin, keeping the token", () => {
    expect(
      rewriteOrigin(
        "http://localhost:3000/api/auth/reset-password/tok_123?callbackURL=%2F",
        "https://billow.example",
      ),
    ).toBe("https://billow.example/api/auth/reset-password/tok_123?callbackURL=%2F");
  });

  it("returns null for an unparseable url", () => {
    expect(rewriteOrigin("not a url", "https://billow.example")).toBeNull();
  });

  it("returns null for an unparseable origin", () => {
    expect(rewriteOrigin("http://localhost:3000/x", "nonsense")).toBeNull();
  });
});
