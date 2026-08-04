import {
  type APIRequestContext,
  expect,
  type Page,
  test as setup,
} from "@playwright/test";

import {
  OWNER_STORAGE_STATE_PATH,
  saveOwnerCredentials,
  uniqueEmail,
  uniqueSuffix,
} from "../fixtures/users";

/**
 * This is both the "setup" project Playwright dependencies expect (see
 * playwright.config.ts) *and* the test for flow #1 in the task this suite
 * was built against: first-run registration. Registration on a fresh Billow
 * installation is first-user-only (packages/auth/src/registration.ts), so
 * whichever spec registers first becomes the permanent admin/owner for the
 * rest of the run — that must be this file, deterministically, which is
 * exactly what a Playwright "setup" project guarantees: it runs to
 * completion before any dependent project starts.
 *
 * Everything downstream (tests/*.spec.ts) reuses the storage state and
 * credentials this test saves to ./.auth/ rather than registering again.
 */

const ownerName = "Billow E2E Owner";
const ownerEmail = uniqueEmail("owner");
const ownerPassword = `Billow-e2e-owner-${uniqueSuffix()}!`;

setup(
  "register the owner account and confirm registration then closes",
  async ({ page, request }) => {
    await landingPageOffersRegistration(page);
    await registerLandsOnDashboard(page);
    await secondSignUpIsRejected(request);

    await page.context().storageState({ path: OWNER_STORAGE_STATE_PATH });
    await saveOwnerCredentials({
      name: ownerName,
      email: ownerEmail,
      password: ownerPassword,
    });
  },
);

async function landingPageOffersRegistration(page: Page) {
  await page.goto("/");
  // A fresh installation has zero users, so canRegister() is true and the
  // marketing page's primary CTA is "Get started" (see apps/web/src/app/page.tsx).
  // The same link/label appears twice (nav bar and hero); scope to the nav.
  const nav = page.getByRole("navigation", { name: "Marketing navigation" });
  await expect(nav.getByRole("link", { name: "Get started" })).toBeVisible();
  await nav.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/register$/);
}

async function registerLandsOnDashboard(page: Page) {
  await page.getByLabel("Name").fill(ownerName);
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: `Welcome back, ${ownerName}` }),
  ).toBeVisible();
}

async function secondSignUpIsRejected(request: APIRequestContext) {
  // A second account, signing up from a browser-less client with no session
  // cookie at all. The owner above is already the first (and only) user, so
  // the database create-hook (packages/auth/src/auth.ts) must reject this
  // with 403 rather than silently creating a second admin-less account.
  const response = await request.post("/api/auth/sign-up/email", {
    data: {
      name: "Second User",
      email: uniqueEmail("rejected"),
      password: `Billow-e2e-rejected-${uniqueSuffix()}!`,
    },
  });

  expect(response.status()).toBe(403);
}
