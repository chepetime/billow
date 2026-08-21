import { expect, type Page } from "@playwright/test";

/**
 * Walk a freshly registered account through the recovery-key step.
 *
 * Every new account lands on /onboarding/recovery-key rather than the
 * dashboard, and OnboardingGate (apps/web/src/app/(app)/_components/
 * onboarding-gate.tsx) bounces every route under (app) back to it until the
 * key is confirmed. So any spec that registers an account has to come through
 * here before it can assert anything else — this is shared between the owner
 * in tests/setup/first-run.setup.ts and the second account in
 * tests/admin-and-isolation.spec.ts.
 *
 * Confirming is also what unwraps the account's data key, which is what makes
 * the encrypted columns in tests/invoicing.spec.ts readable afterwards.
 */
export async function completeRecoveryKeyOnboarding(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/onboarding\/recovery-key$/);
  await page.getByRole("button", { name: "Generate recovery key" }).click();

  const revealed = page.getByTestId("revealed-secret");
  await expect(revealed).toBeVisible();
  const recoveryKey = (await revealed.textContent())?.trim() ?? "";
  expect(recoveryKey.length).toBeGreaterThan(0);

  // By id, not by label: SecretReveal carries an off-screen input labelled
  // "Recovery key" too (it is what a password manager recognises), so the
  // accessible name matches two fields and only one of them is writable.
  await page.locator("#recoveryKeyEntry").fill(recoveryKey);
  await page.getByRole("button", { name: "Confirm and continue" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
}
