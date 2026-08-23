import { describe, expect, it } from "vitest";

import {
  contentDispositionHeader,
  MAX_UPLOADS_PER_USER_BYTES,
  toUploadResponse,
  wouldExceedQuota,
} from "@/lib/uploads";

describe("toUploadResponse", () => {
  it("does not expose storage or ownership internals", () => {
    const response = toUploadResponse({
      id: "upload-1",
      userId: "user-1",
      storageKey: "users/user-1/private.pdf",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      size: 123,
      checksum: "secret-checksum",
      kind: "invoice_document",
      createdAt: new Date("2026-08-21T00:00:00.000Z"),
    });

    expect(response).toEqual({
      id: "upload-1",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      size: 123,
      kind: "invoice_document",
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    expect(response).not.toHaveProperty("storageKey");
    expect(response).not.toHaveProperty("checksum");
    expect(response).not.toHaveProperty("userId");
  });
});

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
