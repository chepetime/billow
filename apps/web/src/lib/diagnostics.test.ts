import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scanStorageUsage } from "@/lib/diagnostics";

// diagnostics.ts imports `auth` from "@billow/auth" at module scope, and
// constructing that instance calls getPrisma() eagerly — which throws
// without a real DATABASE_URL. scanStorageUsage never touches auth, so the
// module is mocked out rather than requiring a database for this test.
vi.mock("@billow/auth", () => ({ auth: {} }));

describe("scanStorageUsage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "billow-storage-"));
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("counts files nested inside per-user subdirectories", async () => {
    // Mirrors the real layout: uploads live under `<userId>/<uuid>.<ext>`,
    // not directly in the storage root.
    await fsp.mkdir(path.join(dir, "user-a"));
    await fsp.mkdir(path.join(dir, "user-b"));
    await fsp.writeFile(path.join(dir, "user-a", "one.png"), "aa");
    await fsp.writeFile(path.join(dir, "user-a", "two.pdf"), "bbb");
    await fsp.writeFile(path.join(dir, "user-b", "three.png"), "c");

    const result = await scanStorageUsage(dir);

    expect(result).toEqual({ files: 3, bytes: 2 + 3 + 1, truncated: false });
  });

  it("truncates and reports truncation once the entry cap is hit", async () => {
    await fsp.mkdir(path.join(dir, "user-a"));
    for (let i = 0; i < 5; i++) {
      await fsp.writeFile(path.join(dir, "user-a", `${i}.png`), "x");
    }

    // A low cap makes the truncation path reachable without creating
    // thousands of real files.
    const result = await scanStorageUsage(dir, 3);

    expect(result.truncated).toBe(true);
    expect(result.files).toBeLessThan(5);
  });

  it("does not follow a symlink out of the storage root", async () => {
    const outside = await fsp.mkdtemp(
      path.join(os.tmpdir(), "billow-outside-"),
    );
    try {
      await fsp.writeFile(path.join(outside, "secret.txt"), "nope");
      await fsp.symlink(outside, path.join(dir, "escape"));

      // A real file inside the root is still counted; only the link is
      // skipped.
      await fsp.writeFile(path.join(dir, "real.png"), "ok");

      const result = await scanStorageUsage(dir);

      expect(result.files).toBe(1);
      expect(result.truncated).toBe(false);
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });

  it("skips an entry that fails to stat instead of aborting the scan", async () => {
    await fsp.mkdir(path.join(dir, "user-a"));
    await fsp.writeFile(path.join(dir, "user-a", "good.png"), "ok");
    await fsp.writeFile(path.join(dir, "user-a", "bad.png"), "boom");

    const originalStat = fsp.stat;
    const statSpy = vi
      .spyOn(fsp, "stat")
      .mockImplementation(async (target, opts) => {
        if (String(target).endsWith("bad.png")) {
          throw new Error("EACCES: permission denied");
        }
        return originalStat(target as string, opts as never);
      });

    try {
      const result = await scanStorageUsage(dir);
      expect(result.files).toBe(1);
      expect(result.truncated).toBe(false);
    } finally {
      statSpy.mockRestore();
    }
  });

  it("bounds recursion depth and reports truncation", async () => {
    let current = dir;
    for (let i = 0; i < 5; i++) {
      current = path.join(current, `level-${i}`);
      await fsp.mkdir(current);
    }
    await fsp.writeFile(path.join(current, "deep.png"), "x");

    const result = await scanStorageUsage(dir, 20_000, 2);

    expect(result.truncated).toBe(true);
    expect(result.files).toBe(0);
  });
});
