import { describe, expect, it } from "vitest";

import {
  formatBytes,
  uploadListResponseSchema,
  uploadResponseSchema,
} from "@/lib/schemas/uploads";

describe("uploadResponseSchema", () => {
  it("accepts the shape returned by the uploads API", () => {
    const result = uploadResponseSchema.safeParse({
      id: "up_1",
      filename: "avatar.png",
      contentType: "image/png",
      size: 1024,
      kind: "attachment",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative size", () => {
    expect(
      uploadResponseSchema.safeParse({
        id: "up_1",
        filename: "avatar.png",
        contentType: "image/png",
        size: -1,
        kind: "attachment",
        createdAt: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("uploadListResponseSchema", () => {
  const emptyByKind = {
    attachment: 0,
    invoice_document: 0,
    tax_period_document: 0,
  };

  it("accepts an empty list with usage totals", () => {
    const result = uploadListResponseSchema.safeParse({
      uploads: [],
      usage: {
        bytes: 0,
        byKind: emptyByKind,
        limitBytes: 100 * 1024 * 1024,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a zero or negative quota limit", () => {
    expect(
      uploadListResponseSchema.safeParse({
        uploads: [],
        usage: { bytes: 0, byKind: emptyByKind, limitBytes: 0 },
      }).success,
    ).toBe(false);
  });

  it("requires the per-kind breakdown", () => {
    // usage.bytes counts kinds the default listing hides, so a response
    // without the breakdown gives a client no way to reconcile the two.
    expect(
      uploadListResponseSchema.safeParse({
        uploads: [],
        usage: { bytes: 0, limitBytes: 100 * 1024 * 1024 },
      }).success,
    ).toBe(false);
  });

  it("accepts a breakdown that does not add up to the total", () => {
    // A kind this app does not know about still counts against the quota,
    // so the total is deliberately not a sum of the listed parts.
    expect(
      uploadListResponseSchema.safeParse({
        uploads: [],
        usage: {
          bytes: 900,
          byKind: { ...emptyByKind, attachment: 400 },
          limitBytes: 100 * 1024 * 1024,
        },
      }).success,
    ).toBe(true);
  });
});

describe("formatBytes", () => {
  it("formats sub-kilobyte counts as bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats larger counts with a unit suffix", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB");
  });
});
