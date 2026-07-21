import { describe, expect, it } from "vitest";

import { getAuthEnv } from "@/lib/auth-env";

const validSecret = "0123456789abcdef0123456789abcdef";

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
    });
  });
});
