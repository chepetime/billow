import { expect, request as apiRequest, test } from "@playwright/test";

import { BASE_URL } from "./fixtures/base-url";
import { readOwnerCredentials, uniqueSuffix } from "./fixtures/users";

/**
 * Flow #4: create a personal API key in the UI, then use it — with no
 * browser session at all — to call the public API and get back the same
 * account. A key that doesn't verify must be rejected with 401.
 */

test("a created API key authenticates /api/v1/me as the owning account", async ({
  page,
}) => {
  const owner = await readOwnerCredentials();
  const keyName = `e2e-key-${uniqueSuffix()}`;

  await page.goto("/settings/api-keys");
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });

  await page.getByLabel("Key name").fill(keyName);
  await page.getByRole("button", { name: "Create key" }).click();

  await expect(
    page.getByText("Copy your key now — it won't be shown again."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy key" }).click();
  const key = await page.evaluate(() => navigator.clipboard.readText());
  expect(key.length).toBeGreaterThan(10);

  // A brand-new API context with no cookies at all — not the browser session
  // this page is signed in with. The key alone must be sufficient.
  const anonymous = await apiRequest.newContext({ baseURL: BASE_URL });
  try {
    const response = await anonymous.get("/api/v1/me", {
      headers: { "x-api-key": key },
    });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as { email: string; name: string };
    expect(body.email).toBe(owner.email);
    expect(body.name).toBe(owner.name);
  } finally {
    await anonymous.dispose();
  }

  await expect(
    page.getByRole("listitem").filter({ hasText: keyName }),
  ).toBeVisible();
});

test("an invalid API key is rejected with 401", async () => {
  const anonymous = await apiRequest.newContext({ baseURL: BASE_URL });
  try {
    const response = await anonymous.get("/api/v1/me", {
      headers: { "x-api-key": `not-a-real-key-${uniqueSuffix()}` },
    });
    expect(response.status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});
