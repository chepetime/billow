import { gunzipSync } from "node:zlib";
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
  await page
    .locator('input[type="file"]')
    .setInputFiles(validPngFile(filename));
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

/**
 * Flow #10b: the opt-in encrypted export, and the plaintext default it exists
 * to make a choice rather than a surprise.
 *
 * The filename asserted on is the lever: it is written into `backup.json` as
 * `uploads[].filename`, so a plain archive contains it in the clear and a
 * sealed one must not contain it anywhere — which is the only way to tell
 * "encrypted" from "the request happened to succeed".
 *
 * Minting a recovery key rotates whatever the account had and clears the
 * "saved" confirmation, so this test confirms the new key immediately. Without
 * that the owner would be left owing an onboarding step and every later spec
 * would meet the gate.
 */
test("an encrypted backup hides its contents and restores with the recovery key", async ({
  page,
  request,
}) => {
  const filename = `billow-sealed-${uniqueSuffix()}.png`;
  const sameOrigin = { Origin: BASE_URL };

  await page.goto("/settings/files");
  await page
    .locator('input[type="file"]')
    .setInputFiles(validPngFile(filename));
  await expect(
    page.getByRole("listitem").filter({ hasText: filename }),
  ).toBeVisible();

  const issued = await request.post("/api/v1/recovery-key", {
    headers: sameOrigin,
  });
  expect(issued.status()).toBe(200);
  const { recoveryKey } = (await issued.json()) as { recoveryKey: string };

  const confirmed = await request.post("/api/v1/recovery-key/confirm", {
    headers: sameOrigin,
    data: { recoveryKey },
  });
  expect(confirmed.status()).toBe(200);

  // The documented default: decrypted on purpose, and visibly so.
  const plain = await request.get("/api/admin/backup");
  expect(plain.status()).toBe(200);
  expect(gunzipSync(await plain.body()).toString("binary")).toContain(filename);

  // A key that is not this account's is refused before anything is built,
  // rather than producing a file that could never be opened.
  const wrongKey = await request.get("/api/admin/backup", {
    headers: { "x-billow-recovery-key": "0000-0000-0000-0000" },
  });
  expect(wrongKey.status()).toBe(400);

  const sealed = await request.get("/api/admin/backup", {
    headers: { "x-billow-recovery-key": recoveryKey },
  });
  expect(sealed.status()).toBe(200);
  expect(sealed.headers()["content-disposition"]).toContain("encrypted");

  const archive = await sealed.body();
  const unpacked = gunzipSync(archive).toString("binary");
  expect(unpacked).toContain("backup-envelope.json");
  expect(unpacked).not.toContain(filename);
  // The manifest's own field names would survive any partial encryption.
  expect(unpacked).not.toContain("formatVersion");

  const withoutKey = await request.post("/api/admin/restore", {
    headers: { "Content-Type": "application/octet-stream", ...sameOrigin },
    data: archive,
  });
  expect(withoutKey.status()).toBe(400);

  const restored = await request.post("/api/admin/restore", {
    headers: {
      "Content-Type": "application/octet-stream",
      "x-billow-recovery-key": recoveryKey,
      ...sameOrigin,
    },
    data: archive,
  });
  expect(restored.status()).toBe(200);

  const body = (await restored.json()) as {
    uploads: { uploads: number; skippedUploads: number; reasons: string[] };
  };
  expect(body.uploads.skippedUploads, body.uploads.reasons.join("; ")).toBe(0);
  expect(body.uploads.uploads).toBeGreaterThan(0);
});

/**
 * Flow #10c: Backup moved out of the generic Administration page into its
 * own Settings tab, and the CSV export that lives beside it there.
 *
 * The CSV assertion only pins down structure (header row, content type), not
 * a specific invoice: this spec's serial group does not create one, and
 * asserting on invoicing.spec.ts's rows would couple two independent files
 * through execution order rather than through anything either declares.
 */
test("the Backup settings page offers both the archive and a CSV export", async ({
  page,
  request,
}) => {
  await page.goto("/settings/backup");
  await expect(
    page.getByRole("heading", { name: "Backup", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download backup" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download invoices.csv" }),
  ).toBeVisible();

  const csv = await request.get("/api/admin/invoices/export");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect((await csv.body()).toString("utf8")).toMatch(
    /^Invoice Number,Date,Client,Currency,Status,Total\r\n/,
  );
});
