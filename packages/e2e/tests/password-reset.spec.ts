import { expect, test } from "@playwright/test";

// These run signed out: the reset pages are guest-only.
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * This suite runs against an installation with no email provider configured,
 * which is the default state and the one most self-hosted installs are in.
 * Password reset is therefore expected to be HIDDEN — a "Forgot your
 * password?" link here would lead to a form whose only possible outcome is
 * "check your inbox" for a message that can never be sent.
 *
 * The positive path (link visible once a test message has actually been
 * delivered) needs a live provider and a verified sending domain, so it is
 * covered by unit tests over resolveEmailCapability rather than here.
 */

test("no recovery link is offered when email is not configured", async ({
  page,
}) => {
  await page.goto("/login");

  await expect(page.getByLabel("Username or email")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /forgot your password/i }),
  ).toHaveCount(0);
});

test("the request page is not reachable when email is not configured", async ({
  page,
}) => {
  // Hiding the link is not enough: a bookmark or shared URL must not reach a
  // form that cannot work.
  const response = await page.goto("/forgot-password");
  expect(response?.status()).toBe(404);
});

test("an invalid or expired token still lands on a recoverable dead end", async ({
  page,
}) => {
  // Deliberately NOT gated on the email capability: a token already sitting in
  // someone's inbox stays valid for an hour, and withdrawing this page because
  // delivery broke would strand a user holding a good link.
  await page.goto("/reset-password?error=INVALID_TOKEN");

  await expect(
    page.getByRole("heading", { name: /no longer valid/i }),
  ).toBeVisible();
});

test("opening the reset page with no token is treated as invalid", async ({
  page,
}) => {
  await page.goto("/reset-password");

  await expect(
    page.getByRole("heading", { name: /no longer valid/i }),
  ).toBeVisible();
});

test("the reset form validates before spending the token", async ({ page }) => {
  // A syntactically valid token that does not exist: enough to render the
  // form, so client-side validation can be exercised without a real email.
  await page.goto("/reset-password?token=not-a-real-token");

  await expect(
    page.getByRole("heading", { name: /choose a new password/i }),
  ).toBeVisible();

  await page.getByLabel("New password", { exact: true }).fill("short");
  await page.getByLabel("Confirm new password").fill("short");
  await page.getByRole("button", { name: /set new password/i }).click();
  await expect(page.getByText(/at least 8 characters/i)).toBeVisible();

  // Mismatch is caught client-side too: the API takes one password, so a typo
  // in a field nobody can read back would otherwise be unrecoverable.
  await page
    .getByLabel("New password", { exact: true })
    .fill("a-long-enough-password");
  await page.getByLabel("Confirm new password").fill("a-different-password");
  await page.getByRole("button", { name: /set new password/i }).click();
  await expect(page.getByText(/do not match/i)).toBeVisible();
});
