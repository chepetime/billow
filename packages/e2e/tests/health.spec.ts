import { expect, test } from "@playwright/test";

/**
 * Flow #8: /health is public and shows only a boolean status — no versions,
 * memory, stack traces or environment (see apps/web/src/app/health/page.tsx).
 * /admin/debug carries all of that detail, so it requires a session.
 */

test.describe("public status page", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/health is reachable while signed out and reveals no internals", async ({
    page,
  }) => {
    await page.goto("/health");
    await expect(page).toHaveURL(/\/health$/);
    await expect(
      page.getByRole("heading", { name: /operational|unavailable/i }),
    ).toBeVisible();

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    for (const leak of ["heap", "node v", "process.env", "stack trace"]) {
      expect(bodyText).not.toContain(leak);
    }
  });

  test("/admin/debug redirects an anonymous visitor to /login", async ({
    page,
  }) => {
    await page.goto("/admin/debug");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test("a signed-in owner can view diagnostics at /admin/debug", async ({
  page,
}) => {
  await page.goto("/admin/debug");
  await expect(page).toHaveURL(/\/admin\/debug$/);
  await expect(page.getByRole("heading", { name: "Debug" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Database" })).toBeVisible();
});
