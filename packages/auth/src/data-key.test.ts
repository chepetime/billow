import { describe, expect, it, vi } from "vitest";

// data-key.ts imports "server-only" and "next/headers" for its DB-backed
// functions, neither of which is relevant to the pure transport-security
// helpers under test here — mocked the same way session.test.ts mocks them.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const {
  dataKeyCookieIsSecure,
  dataKeyCookieOptions,
  pendingDataKeyCookieOptions,
  dataKeyCookies,
} = await import("./data-key");

describe("dataKeyCookieIsSecure", () => {
  it("is false for a plain-HTTP request (no x-forwarded-proto)", () => {
    expect(dataKeyCookieIsSecure(new Headers())).toBe(false);
  });

  it("is false when x-forwarded-proto is explicitly http", () => {
    expect(
      dataKeyCookieIsSecure(new Headers({ "x-forwarded-proto": "http" })),
    ).toBe(false);
  });

  it("is true when x-forwarded-proto is https", () => {
    expect(
      dataKeyCookieIsSecure(new Headers({ "x-forwarded-proto": "https" })),
    ).toBe(true);
  });

  it("is false for any other value, rather than defaulting open", () => {
    expect(
      dataKeyCookieIsSecure(new Headers({ "x-forwarded-proto": "HTTPS" })),
    ).toBe(false);
    expect(
      dataKeyCookieIsSecure(new Headers({ "x-forwarded-proto": "wss" })),
    ).toBe(false);
  });
});

describe("dataKeyCookieOptions", () => {
  it("carries no secure flag for a plain-HTTP request", () => {
    const options = dataKeyCookieOptions(new Headers());

    expect(options.secure).toBe(false);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("sets secure for a request that arrived over HTTPS", () => {
    const options = dataKeyCookieOptions(
      new Headers({ "x-forwarded-proto": "https" }),
    );

    expect(options.secure).toBe(true);
  });

  it("keeps the 7-day maxAge the static options use", () => {
    const options = dataKeyCookieOptions(new Headers());

    expect(options.maxAge).toBe(dataKeyCookies.options.maxAge);
  });
});

describe("pendingDataKeyCookieOptions", () => {
  it("carries no secure flag for a plain-HTTP request", () => {
    expect(pendingDataKeyCookieOptions(new Headers()).secure).toBe(false);
  });

  it("sets secure for a request that arrived over HTTPS", () => {
    expect(
      pendingDataKeyCookieOptions(new Headers({ "x-forwarded-proto": "https" }))
        .secure,
    ).toBe(true);
  });

  it("keeps the short pending-cookie maxAge, not the 7-day session one", () => {
    const options = pendingDataKeyCookieOptions(new Headers());

    expect(options.maxAge).toBe(dataKeyCookies.pendingOptions.maxAge);
    expect(options.maxAge).toBeLessThan(dataKeyCookies.options.maxAge);
  });
});

describe("dataKeyCookies (the static options every current caller uses)", () => {
  it("never sets secure, regardless of this change", () => {
    expect(dataKeyCookies.options.secure).toBeUndefined();
    expect(dataKeyCookies.pendingOptions.secure).toBeUndefined();
  });
});
