import { expect, type Page, test } from "@playwright/test";

import { secondsRemainingInPeriod, secretFromUri, totp } from "./fixtures/totp";
import {
  readOwnerCredentials,
  uniqueUsername,
  updateOwnerUsername,
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

/**
 * Flow #8: two-factor enrolment, and the sign-in that it changes.
 *
 * Deliberately in this file rather than its own. Enabling 2FA on the owner
 * account changes how every password sign-in behaves, and files run in
 * parallel workers — but tests *within* a file run serially
 * (`fullyParallel: false`), so keeping this beside the other owner sign-in
 * tests is what guarantees nothing observes 2FA half-enabled. The only other
 * spec that touches /login is password-reset.spec.ts, which never signs in.
 *
 * The test turns 2FA off again at the end. That is not tidiness: leaving it on
 * would break these same tests on the next run against a warm database.
 */
test("enrol in two-factor, sign in with a code, then turn it off", async ({
  page,
}) => {
  const owner = await readOwnerCredentials();

  await signIn(page, owner.email, owner.password, owner.name);
  await page.goto("/settings/security");

  // The shared secret is never rendered — the page only shows a QR image — so
  // it is read from the enable response, which is what a real authenticator
  // would consume from the QR code.
  const enableResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/two-factor/enable") && response.ok(),
  );
  await page.getByLabel("Confirm your password").fill(owner.password);
  await page.getByRole("button", { name: "Set up two-factor" }).click();

  const { totpURI } = (await (await enableResponse).json()) as {
    totpURI: string;
  };
  const secret = secretFromUri(totpURI);

  await expect(
    page.getByText("Save your backup codes — they won't be shown again."),
  ).toBeVisible();

  await submitTotp(page, secret, "Confirm and turn on");
  await expect(
    page.getByRole("button", { name: "Turn off two-factor" }),
  ).toBeVisible();

  // The point of the whole feature: a correct password is no longer enough.
  await signOut(page);
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/two-factor$/);
  await submitTotp(page, secret, "Verify");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings/security");
  await page.getByLabel("Confirm your password").fill(owner.password);
  await page.getByRole("button", { name: "Turn off two-factor" }).click();
  await expect(
    page.getByRole("button", { name: "Set up two-factor" }),
  ).toBeVisible();
});

/**
 * Fill the visible one-time-code field and submit.
 *
 * Waits out the end of a period that is about to expire before generating the
 * code. Without that, a code produced with a second left is already invalid by
 * the time the request is handled — the one way this test can flake while the
 * application is behaving correctly.
 */
async function submitTotp(page: Page, secret: string, buttonName: string) {
  // A wall-clock wait for the TOTP window to roll over, not a wait on the page
  // — there is no UI event to key off, the constraint is the clock itself.
  if (secondsRemainingInPeriod() < 3) {
    await new Promise((resolve) =>
      setTimeout(resolve, secondsRemainingInPeriod() * 1000 + 500),
    );
  }

  await page.getByLabel("Authentication code").fill(totp(secret));
  await page.getByRole("button", { name: buttonName }).click();
}

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
