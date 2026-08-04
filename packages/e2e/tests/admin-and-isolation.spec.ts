import { expect, test } from "@playwright/test";

import { validPngFile } from "./fixtures/files";
import {
  readOwnerCredentials,
  uniqueEmail,
  uniqueSuffix,
} from "./fixtures/users";

/**
 * Flows #6 and #7: administration visibility, and — the most valuable test
 * in this suite — cross-account data isolation.
 *
 * This file is the only place that flips the installation-wide "open
 * registration" toggle. `fullyParallel: false` (see playwright.config.ts)
 * keeps every test in a file on one worker in declaration order by default,
 * so registering the second account, checking it, and closing registration
 * again all happen back-to-back with nothing else able to observe
 * registration open in between.
 */

test.describe
  .serial("administration and data isolation", () => {
    test("the owner sees Administration and appears in the users list", async ({
      page,
    }) => {
      const owner = await readOwnerCredentials();

      await page.goto("/settings/account");
      await expect(
        page.getByRole("link", { name: "Administration" }),
      ).toBeVisible();

      await page.goto("/settings/admin");
      await expect(
        page.getByRole("heading", { name: "Administration" }),
      ).toBeVisible();
      await expect(
        page.getByRole("listitem").filter({ hasText: owner.email }),
      ).toBeVisible();
    });

    test("a non-admin cannot reach admin, and cannot read the owner's upload by id", async ({
      page,
      browser,
    }) => {
      await page.goto("/dashboard");

      // PATCH /api/settings/registration is a same-origin-gated, admin-only
      // mutation (see apps/web/src/app/api/settings/registration/route.ts). The
      // owner's session cookie makes this call authenticate as admin; the
      // explicit Origin header is what page.request needs (a real browser
      // fetch would set it automatically — see the note in uploads.spec.ts).
      const origin = new URL(page.url()).origin;
      const openRegistration = await page.request.patch(
        "/api/settings/registration",
        { data: { enabled: true }, headers: { origin } },
      );
      expect(openRegistration.ok()).toBe(true);

      // browser.newContext() inherits the project's configured `use` options —
      // including storageState — unless told otherwise. Without this override
      // colleagueContext would start already signed in as the owner (via
      // .auth/owner.json), and /register would just redirect it to /dashboard.
      const colleagueContext = await browser.newContext({
        storageState: undefined,
      });
      try {
        const colleaguePage = await colleagueContext.newPage();
        const colleagueName = "Billow E2E Colleague";
        const colleagueEmail = uniqueEmail("colleague");
        const colleaguePassword = `Billow-e2e-colleague-${uniqueSuffix()}!`;

        await colleaguePage.goto("/register");
        await colleaguePage.getByLabel("Name").fill(colleagueName);
        await colleaguePage.getByLabel("Email").fill(colleagueEmail);
        await colleaguePage.getByLabel("Password").fill(colleaguePassword);
        await colleaguePage
          .getByRole("button", { name: "Create account" })
          .click();
        await expect(colleaguePage).toHaveURL(/\/dashboard$/);

        // Visibility: a non-admin's settings sidebar has no Administration
        // link, and navigating there directly redirects away rather than
        // rendering (requireAdmin in packages/auth/src/admin.ts).
        await colleaguePage.goto("/settings/account");
        await expect(
          colleaguePage.getByRole("link", { name: "Administration" }),
        ).toHaveCount(0);

        await colleaguePage.goto("/settings/admin");
        await expect(colleaguePage).not.toHaveURL(/\/settings\/admin$/);

        // Isolation: the owner uploads a private file...
        const upload = await page.request.post("/api/v1/uploads", {
          multipart: {
            file: validPngFile(`billow-e2e-owner-${uniqueSuffix()}.png`),
          },
          headers: { origin },
        });
        expect(upload.ok()).toBe(true);
        const { id: ownerUploadId } = (await upload.json()) as { id: string };

        // ...and the colleague, signed in as a different account entirely,
        // must get exactly the same response a nonexistent id would: 404, not
        // 403. Leaking "403 forbidden" would confirm the id exists and belongs
        // to someone else (see the doc comment on getUploadForUser in
        // apps/web/src/lib/uploads.ts).
        const foreignRead = await colleaguePage.request.get(
          `/api/v1/uploads/${ownerUploadId}`,
        );
        expect(foreignRead.status()).toBe(404);

        // The vault adds a second isolation boundary: an authenticated account
        // also needs its own per-request vault key. The value itself is only
        // ciphertext in Postgres (unit-tested in vault-crypto.test.ts); these
        // requests prove it cannot be read through another user's session.
        const vaultKey = `vault-key-${uniqueSuffix()}`;
        const vaultSecret = `vault-secret-${uniqueSuffix()}`;
        const savedVault = await page.request.post("/api/v1/vault", {
          data: { secret: vaultSecret },
          headers: { origin, "x-billow-vault-key": vaultKey },
        });
        expect(savedVault.status()).toBe(201);

        const wrongKey = await page.request.get("/api/v1/vault", {
          headers: { "x-billow-vault-key": "not-the-owner-key" },
        });
        expect(wrongKey.status()).toBe(401);

        const foreignVaultRead = await colleaguePage.request.get(
          "/api/v1/vault",
          {
            headers: { "x-billow-vault-key": vaultKey },
          },
        );
        expect(foreignVaultRead.status()).toBe(404);
      } finally {
        await colleagueContext.close();
        // Always closes registration again, even if an assertion above threw:
        // leaving it open would let a real, uninvited signup through until the
        // next admin manually notices and disables it.
        const closeRegistration = await page.request.patch(
          "/api/settings/registration",
          { data: { enabled: false }, headers: { origin } },
        );
        expect(closeRegistration.ok()).toBe(true);
      }
    });
  });
