import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { invalidTypeFile, validPngFile } from "./fixtures/files";
import { uniqueSuffix } from "./fixtures/users";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Flow #5: upload a real PNG through the UI, see it listed, download it and
 * confirm the bytes round-trip exactly, then delete it and confirm it's
 * gone. Also: a file whose bytes don't match an accepted type must be
 * rejected, even if it claims an accepted extension/content-type.
 */

test("upload, download, and delete a file through the UI", async ({ page }) => {
  const filename = `billow-e2e-${uniqueSuffix()}.png`;
  const fixture = validPngFile(filename);

  await page.goto("/settings/files");
  // The file input is visually hidden (sr-only) behind a "Choose a file"
  // button, but it's a real <input type="file"> in the DOM and Playwright
  // can drive it directly — no click-through-the-button indirection needed.
  await page.locator('input[type="file"]').setInputFiles(fixture);

  const row = page.getByRole("listitem").filter({ hasText: filename });
  await expect(row).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await row.getByRole("link", { name: "Download" }).click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(downloadedPath, "download should save to a local path").not.toBeNull();
  const downloadedBytes = await readFile(downloadedPath as string);
  expect(sha256(downloadedBytes)).toBe(sha256(fixture.buffer));

  await row.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: filename }),
  ).toHaveCount(0);

  // Confirm the deletion is real, not just an optimistic UI update.
  await page.reload();
  await expect(
    page.getByRole("listitem").filter({ hasText: filename }),
  ).toHaveCount(0);
});

test("a file whose bytes are not an accepted type is rejected", async ({
  page,
}) => {
  const fixture = invalidTypeFile(`billow-e2e-invalid-${uniqueSuffix()}.png`);

  await page.goto("/settings/files");
  // Same-origin mutations are gated on an Origin header (see
  // isSameOriginRequest in apps/web/src/lib/api/request-origin.ts) that only
  // a real browser fetch sets automatically; page.request is a Node-side
  // client, so it's set explicitly here to exercise the same code path the
  // browser's own fetch("/api/v1/uploads", ...) call would.
  const response = await page.request.post("/api/v1/uploads", {
    multipart: { file: fixture },
    headers: { origin: new URL(page.url()).origin },
  });

  expect(response.status()).toBe(415);

  await page.reload();
  await expect(page.getByText(fixture.name)).toHaveCount(0);
});
