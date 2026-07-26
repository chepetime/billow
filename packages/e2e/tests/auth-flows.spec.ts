import { expect, test, type Page } from "@playwright/test";

import {
  readOwnerCredentials,
  updateOwnerUsername,
  uniqueUsername,
} from "./fixtures/users";

/**
 * Flow #2: sign out, sign back in by email, then again by username after
 * setting one in /settings/account.
 *
 * This file deliberately does NOT use the project's default owner storage
 * state (see playwright.config.ts). Every test here signs out at least once,
 * and signing out revokes that session token server-side — if these tests
 * reused the shared `.auth/owner.json` cookie, signing out would invalidate
 * every other spec file that happens to be running concurrently in a
 * different worker against that exact same token. Instead, each test logs in
 * for itself first, getting its own independent session that only this
 * test's own sign-out can affect.
 *
 * The username assigned below is a real, permanent change to the owner
 * account (not session-scoped), and is recorded back to the shared
 * credentials file (updateOwnerUsername) so any other spec that needs it
 * later can read it instead of assuming a fixed value.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("sign out, then sign back in by email", async ({ page }) => {
  const owner = await readOwnerCredentials();

  await signIn(page, owner.email, owner.password, owner.name);
  await signOut(page);

  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, owner.email, owner.password, owner.name);
});

test("set a username, then sign out and sign back in by username", async ({
  page,
}) => {
  const owner = await readOwnerCredentials();
  const username = uniqueUsername("owner");

  await signIn(page, owner.email, owner.password, owner.name);

  await page.goto("/settings/account");
  await page.getByLabel("Username").fill(username);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();

  // Reload to force a fresh mount of the (uncontrolled, defaultValues-only)
  // form and confirm the username actually persisted server-side, not just
  // that the success toast fired.
  await page.reload();
  await expect(page.getByLabel("Username")).toHaveValue(username);

  await updateOwnerUsername(username);

  await signOut(page);
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, username, owner.password, owner.name);
});

async function signIn(
  page: Page,
  identifier: string,
  password: string,
  expectedName: string,
) {
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(identifier);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: `Welcome back, ${expectedName}` }),
  ).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: /Log out/ }).click();
}
