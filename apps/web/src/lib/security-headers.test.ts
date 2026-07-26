import { describe, expect, it } from "vitest";

import { securityHeaders } from "@/lib/security-headers";

function getHeader(key: string): string {
  const header = securityHeaders.find((entry) => entry.key === key);
  if (!header) {
    throw new Error(`missing header: ${key}`);
  }
  return header.value;
}

describe("securityHeaders", () => {
  it("sets X-Content-Type-Options to nosniff", () => {
    expect(getHeader("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets a strict Referrer-Policy", () => {
    expect(getHeader("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("denies framing via X-Frame-Options", () => {
    expect(getHeader("X-Frame-Options")).toBe("DENY");
  });

  it("denies unused device capabilities via Permissions-Policy", () => {
    const policy = getHeader("Permissions-Policy");

    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      expect(policy).toContain(`${feature}=()`);
    }
  });

  it("locks the CSP down to self plus the documented exceptions", () => {
    const csp = getHeader("Content-Security-Policy");

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it("documents the script-src and style-src inline-script weakening", () => {
    const csp = getHeader("Content-Security-Policy");

    // Next.js and next-themes inject inline <script>/<style> without a
    // nonce today (see the comment in security-headers.ts), so 'self'
    // alone would white-screen the app.
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("does not set Strict-Transport-Security", () => {
    const hstsHeader = securityHeaders.find(
      (entry) => entry.key.toLowerCase() === "strict-transport-security",
    );

    expect(hstsHeader).toBeUndefined();
  });
});
