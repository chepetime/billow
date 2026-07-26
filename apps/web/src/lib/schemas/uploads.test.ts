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
  it("accepts an empty list with usage totals", () => {
    const result = uploadListResponseSchema.safeParse({
      uploads: [],
      usage: { bytes: 0, limitBytes: 100 * 1024 * 1024 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a zero or negative quota limit", () => {
    expect(
      uploadListResponseSchema.safeParse({
        uploads: [],
        usage: { bytes: 0, limitBytes: 0 },
      }).success,
    ).toBe(false);
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
