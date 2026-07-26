import { describe, expect, it } from "vitest";

import {
  MAX_UPLOADS_PER_USER_BYTES,
  contentDispositionHeader,
  wouldExceedQuota,
} from "@/lib/uploads";

describe("wouldExceedQuota", () => {
  it("allows an upload that fits within the limit", () => {
    expect(wouldExceedQuota(0, 1024, 2048)).toBe(false);
    expect(wouldExceedQuota(1024, 1024, 2048)).toBe(false);
  });

  it("rejects an upload that would push usage past the limit", () => {
    expect(wouldExceedQuota(1024, 1025, 2048)).toBe(true);
  });

  it("defaults to the per-user quota constant", () => {
    expect(wouldExceedQuota(0, MAX_UPLOADS_PER_USER_BYTES + 1)).toBe(true);
    expect(wouldExceedQuota(0, MAX_UPLOADS_PER_USER_BYTES)).toBe(false);
  });
});

describe("contentDispositionHeader", () => {
  it("wraps an ordinary filename in a quoted attachment disposition", () => {
    expect(contentDispositionHeader("invoice.pdf")).toBe(
      'attachment; filename="invoice.pdf"',
    );
  });

  it("escapes embedded quotes and backslashes so the header stays well-formed", () => {
    expect(contentDispositionHeader('weird"name.png')).toBe(
      'attachment; filename="weird\\"name.png"',
    );
    expect(contentDispositionHeader("back\\slash.png")).toBe(
      'attachment; filename="back\\\\slash.png"',
    );
  });
});
