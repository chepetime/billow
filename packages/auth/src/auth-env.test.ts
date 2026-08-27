import { describe, expect, it } from "vitest";

import { getAuthEnv } from "./auth-env";

const validSecret = "0123456789abcdef0123456789abcdef";
// The shipped budget. Spelled out here rather than imported so a change to
// the default has to be made deliberately in both places.
const defaultRateLimit = { max: 120, windowMs: 60_000 };

describe("getAuthEnv", () => {
  it("returns BetterAuth environment values", () => {
    expect(
      getAuthEnv({
        BETTER_AUTH_SECRET: validSecret,
        BETTER_AUTH_URL: "http://localhost:3000",
      }),
    ).toEqual({
      secret: validSecret,
      baseUrl: "http://localhost:3000",
      apiKeyRateLimit: defaultRateLimit,
    });
  });

  it("falls back to NEXT_PUBLIC_APP_URL for the base URL", () => {
    expect(
      getAuthEnv({
        BETTER_AUTH_SECRET: validSecret,
        NEXT_PUBLIC_APP_URL: "https://billow.example",
      }),
    ).toEqual({
      secret: validSecret,
      baseUrl: "https://billow.example",
      apiKeyRateLimit: defaultRateLimit,
    });
  });

  it("rejects short secrets", () => {
    expect(() =>
      getAuthEnv({
        BETTER_AUTH_SECRET: "too-short",
        BETTER_AUTH_URL: "http://localhost:3000",
      }),
    ).toThrow("BETTER_AUTH_SECRET must be at least 32 characters.");
  });

  it("defaults the base URL to the in-container address when none is provided", () => {
    expect(
      getAuthEnv({
        BETTER_AUTH_SECRET: validSecret,
      }),
    ).toEqual({
      secret: validSecret,
      baseUrl: "http://localhost:3000",
      apiKeyRateLimit: defaultRateLimit,
    });
  });

  it("uses PORT for the default base URL", () => {
    expect(
      getAuthEnv({
        BETTER_AUTH_SECRET: validSecret,
        PORT: "4321",
      }).baseUrl,
    ).toBe("http://localhost:4321");
  });

  it("allows build-only fallback values when requested", () => {
    expect(getAuthEnv({}, { allowBuildFallback: true })).toEqual({
      secret: "build-only-better-auth-placeholder",
      baseUrl: "http://localhost:3000",
      apiKeyRateLimit: defaultRateLimit,
    });
  });
});

describe("getAuthEnv API key rate limit", () => {
  it("does not inherit the plugin's 10-per-day default", () => {
    // The regression this guards: with no rateLimit passed, BetterAuth's
    // api-key plugin allows 10 requests per 24 hours, and a key used by the
    // owner's own tooling is exhausted within minutes.
    const { apiKeyRateLimit } = getAuthEnv({ BETTER_AUTH_SECRET: validSecret });
    expect(apiKeyRateLimit.max).toBeGreaterThan(10);
    expect(apiKeyRateLimit.windowMs).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it("reads overrides from the environment, converting the window to ms", () => {
    expect(
      getAuthEnv({
        BETTER_AUTH_SECRET: validSecret,
        BILLOW_API_KEY_RATE_LIMIT_MAX: "500",
        BILLOW_API_KEY_RATE_LIMIT_WINDOW_SECONDS: "30",
      }).apiKeyRateLimit,
    ).toEqual({ max: 500, windowMs: 30_000 });
  });

  it.each(["", "0", "-5", "12.5", "many", "  ", "300x"])(
    "falls back to the default rather than failing to boot on %j",
    (raw) => {
      expect(
        getAuthEnv({
          BETTER_AUTH_SECRET: validSecret,
          BILLOW_API_KEY_RATE_LIMIT_MAX: raw,
        }).apiKeyRateLimit,
      ).toEqual(defaultRateLimit);
    },
  );
});
