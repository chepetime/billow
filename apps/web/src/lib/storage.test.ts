import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildStorageKey,
  deleteUserDirectory,
  detectType,
  resolveStoragePath,
  resolveUserDirectory,
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
    expect(
      detectType(new Uint8Array([0x3c, 0x3f, 0x70, 0x68, 0x70])),
    ).toBeNull();
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

describe("resolveUserDirectory / deleteUserDirectory", () => {
  let root: string;
  let previousStorageDir: string | undefined;

  beforeEach(async () => {
    previousStorageDir = process.env.BILLOW_STORAGE_DIR;
    root = await mkdtemp(path.join(tmpdir(), "billow-storage-test-"));
    process.env.BILLOW_STORAGE_DIR = root;
  });

  afterEach(async () => {
    process.env.BILLOW_STORAGE_DIR = previousStorageDir;
    await rm(root, { recursive: true, force: true });
  });

  it("resolves a user id to its subdirectory of the storage root", () => {
    const target = resolveUserDirectory("user-123");
    expect(target).toBe(path.join(root, "user-123"));
  });

  it("refuses an empty user id rather than collapsing to the root", () => {
    expect(() => resolveUserDirectory("")).toThrow();
  });

  it("refuses a user id that resolves to the storage root itself", () => {
    // "." is the traversal-shaped case resolveStoragePath's containment
    // check alone does not catch: it resolves to the root, and the root
    // "hasn't escaped" from that guard's point of view.
    expect(() => resolveUserDirectory(".")).toThrow();
  });

  it("refuses a traversal-shaped user id that would escape the root", () => {
    expect(() => resolveUserDirectory("../elsewhere")).toThrow();
    expect(() => resolveUserDirectory("../../etc")).toThrow();
  });

  it("removes only the target user's directory and its contents", async () => {
    // Mirrors the real layout: a folder per user id (see buildStorageKey)
    // holding generated-name files, plus an unrelated file sitting directly
    // in the root to prove the delete doesn't wander past the one directory.
    await mkdir(path.join(root, "user-a"), { recursive: true });
    await mkdir(path.join(root, "user-b"), { recursive: true });
    await writeFile(path.join(root, "user-a", "one.png"), "a1");
    await writeFile(path.join(root, "user-b", "two.png"), "b1");
    await writeFile(path.join(root, "user-a.png"), "not a user directory");

    await deleteUserDirectory("user-a");

    await expect(stat(path.join(root, "user-a"))).rejects.toThrow();
    await expect(
      readFile(path.join(root, "user-b", "two.png"), "utf8"),
    ).resolves.toBe("b1");
    await expect(readFile(path.join(root, "user-a.png"), "utf8")).resolves.toBe(
      "not a user directory",
    );
  });

  it("is a no-op when the user has no directory yet", async () => {
    await expect(
      deleteUserDirectory("never-uploaded"),
    ).resolves.toBeUndefined();
  });
});
