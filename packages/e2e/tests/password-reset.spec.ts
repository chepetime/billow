import { expect, test } from "@playwright/test";

// These run signed out: the reset pages are guest-only.
test.use({ storageState: { cookies: [], origins: [] } });

test("the sign-in page offers a way to recover a password", async ({ page }) => {
  await page.goto("/login");

  const link = page.getByRole("link", { name: /forgot your password/i });
  await expect(link).toBeVisible();

  await link.click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(
    page.getByRole("heading", { name: /reset your password/i }),
  ).toBeVisible();
});

test("requesting a reset does not reveal whether the address exists", async ({
  page,
}) => {
  await page.goto("/forgot-password");

  // An address that certainly has no account. The response must be the same
  // one a real account gets, or this form becomes a way to enumerate users.
  await page.getByLabel("Email").fill("definitely-not-a-user@example.com");
  await page.getByRole("button", { name: /send reset link/i }).click();

  await expect(page.getByText(/if that address belongs to an account/i)).toBeVisible();
});

test("an invalid or expired token lands on a recoverable dead end", async ({
  page,
}) => {
  // BetterAuth redirects here with ?error=INVALID_TOKEN when the token is
  // unknown or expired, so this is the page a stale link actually reaches.
  await page.goto("/reset-password?error=INVALID_TOKEN");

  await expect(
    page.getByRole("heading", { name: /no longer valid/i }),
  ).toBeVisible();

  // The dead end must offer a way out, not just an error.
  await page.getByRole("link", { name: /request a new link/i }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
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
  await page.getByLabel("New password", { exact: true }).fill("a-long-enough-password");
  await page.getByLabel("Confirm new password").fill("a-different-password");
  await page.getByRole("button", { name: /set new password/i }).click();
  await expect(page.getByText(/do not match/i)).toBeVisible();
});
