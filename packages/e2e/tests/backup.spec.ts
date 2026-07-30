import { expect, test } from "@playwright/test";

import { BASE_URL } from "./fixtures/base-url";
import { validPngFile } from "./fixtures/files";
import { uniqueSuffix } from "./fixtures/users";

/**
 * Flow #10: a backup round-trip that includes uploaded files.
 *
 * This is the regression test for the gap the archive format was built to
 * close — an export that carried domain rows but not files, so a restore
 * looked successful and silently came back without attachments. Asserting the
 * file count grows is the whole point; asserting the request succeeded would
 * have passed before the fix too.
 *
 * Restoring deliberately adds rather than replaces, so this test increases the
 * owner's row counts. Nothing else asserts an exact total, and uploads.spec.ts
 * scopes its assertions to files it creates itself.
 */

test("a backup round-trip restores uploaded files, not just rows", async ({
  page,
  request,
}) => {
  const filename = `billow-backup-${uniqueSuffix()}.png`;

  await page.goto("/settings/files");
  // The input is sr-only behind a button but is a real file input, as in
  // uploads.spec.ts.
  await page.locator('input[type="file"]').setInputFiles(validPngFile(filename));
  await expect(
    page.getByRole("listitem").filter({ hasText: filename }),
  ).toBeVisible();

  const before = await countUploads();

  // Downloaded through the browser's session so the admin check applies.
  const exported = await request.get("/api/admin/backup");
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toContain("gzip");
  const archive = await exported.body();
  // A gzip member always starts 1f 8b; a JSON export would start "{".
  expect(archive.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));

  const restored = await request.post("/api/admin/restore", {
    headers: {
      "Content-Type": "application/octet-stream",
      // Cookie-authenticated mutations are rejected without a matching Origin
      // (see lib/api/request-origin.ts); a browser sends this automatically.
      Origin: BASE_URL,
    },
    data: archive,
  });
  expect(restored.status()).toBe(200);

  const body = (await restored.json()) as {
    uploads: { uploads: number; skippedUploads: number; reasons: string[] };
  };

  // Every file in the archive must come back. A skip here means the manifest
  // and the bytes disagreed, or the quota was hit.
  expect(body.uploads.skippedUploads, body.uploads.reasons.join("; ")).toBe(0);
  expect(body.uploads.uploads).toBeGreaterThan(0);

  expect(await countUploads()).toBe(before + body.uploads.uploads);

  async function countUploads(): Promise<number> {
    const response = await request.get("/api/v1/uploads");
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as { uploads: unknown[] };
    return payload.uploads.length;
  }
});
