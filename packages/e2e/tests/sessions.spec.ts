import { expect, test } from "@playwright/test";

/**
 * Flow #9: the active-sessions list on /settings/security.
 *
 * Read-only on purpose. This spec runs with the shared owner storage state, so
 * actually revoking a session would invalidate the exact token every other
 * spec file is using concurrently. Enrolment-and-revocation of a session the
 * test owns outright is covered by the sign-out assertions in
 * auth-flows.spec.ts, which uses its own isolated session.
 */

test("the current device is listed as an active session and cannot sign itself out", async ({
  page,
}) => {
  await page.goto("/settings/security");

  await expect(
    page.getByRole("heading", { name: "Active sessions" }),
  ).toBeVisible();

  const currentDevice = page
    .getByRole("listitem")
    .filter({ hasText: "This device" });
  await expect(currentDevice).toBeVisible();

  // The session serving this page must not offer to revoke itself — that would
  // sign the user out from the page they are using to manage sessions.
  await expect(
    currentDevice.getByRole("button", { name: "Sign out" }),
  ).toHaveCount(0);
});
