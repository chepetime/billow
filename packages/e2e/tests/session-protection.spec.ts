import { expect, test } from "@playwright/test";

/**
 * Flow #3: protected routes must not render for a signed-out visitor.
 *
 * This overrides the project's default storage state (the owner's signed-in
 * session — see playwright.config.ts) with a blank one, so this file runs as
 * a genuinely anonymous visitor regardless of which project executes it.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("visiting /dashboard signed out redirects to /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Sign in to Billow" }),
  ).toBeVisible();
});

test("visiting /settings signed out redirects to /login", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Sign in to Billow" }),
  ).toBeVisible();
});

test("visiting a nested /settings/* route signed out redirects to /login", async ({
  page,
}) => {
  await page.goto("/settings/admin");
  await expect(page).toHaveURL(/\/login$/);
});
