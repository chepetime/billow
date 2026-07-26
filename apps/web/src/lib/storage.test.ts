import { describe, expect, it } from "vitest";

import {
  buildStorageKey,
  detectType,
  resolveStoragePath,
  safeDisplayName,
} from "@/lib/storage";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("detectType", () => {
  it("identifies files by their leading bytes", () => {
    expect(detectType(png)?.mime).toBe("image/png");
    expect(detectType(pdf)?.mime).toBe("application/pdf");
    expect(detectType(webp)?.mime).toBe("image/webp");
  });

  it("rejects content that matches no accepted type", () => {
    expect(detectType(new Uint8Array([0x3c, 0x3f, 0x70, 0x68, 0x70]))).toBeNull();
    expect(detectType(new Uint8Array([]))).toBeNull();
  });

  it("ignores a filename or declared type entirely", () => {
    // A script renamed to .png still fails, because only bytes are inspected.
    const script = new Uint8Array([0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e]);
    expect(detectType(script)).toBeNull();
  });
});

describe("safeDisplayName", () => {
  it("keeps ordinary names, including spaces and hyphens", () => {
    expect(safeDisplayName("Invoice 2026-07.pdf")).toBe("Invoice 2026-07.pdf");
  });

  it("strips any path the client supplied", () => {
    expect(safeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(safeDisplayName("C:\\Windows\\system32\\bad.png")).toBe("bad.png");
  });

  it("removes control characters and falls back when nothing remains", () => {
    expect(safeDisplayName("a\u0000b.png")).toBe("ab.png");
    expect(safeDisplayName("\u0001\u0002")).toBe("file");
  });
});

describe("resolveStoragePath", () => {
  it("resolves keys inside the storage root", () => {
    const key = buildStorageKey("user123", "png");
    expect(resolveStoragePath(key)).toContain("user123");
  });

  it("refuses keys that escape the root", () => {
    expect(() => resolveStoragePath("../../etc/passwd")).toThrow();
    expect(() => resolveStoragePath("/etc/passwd")).toThrow();
  });
});

describe("buildStorageKey", () => {
  it("never reuses the client filename and is unique per call", () => {
    const a = buildStorageKey("u1", "pdf");
    const b = buildStorageKey("u1", "pdf");
    expect(a).not.toBe(b);
    expect(a.startsWith("u1/")).toBe(true);
    expect(a.endsWith(".pdf")).toBe(true);
  });
});
