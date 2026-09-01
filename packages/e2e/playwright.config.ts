import { defineConfig, devices } from "@playwright/test";

import { BASE_URL } from "./tests/fixtures/base-url";

/**
 * End-to-end suite for a *running* Billow instance.
 *
 * This config deliberately has no `webServer` entry: the suite never starts
 * the app itself. In CI (see .github/workflows/e2e.yml) a real Postgres
 * container and the production Docker image are already up before
 * `pnpm test:e2e` runs; locally, point BASE_URL at `pnpm dev:local` (or any
 * other running instance) instead.
 *
 * The database is not reset between specs — there is exactly one Postgres
 * container for the whole run, in CI and locally alike. Two consequences
 * shape everything under tests/:
 *
 *   1. Registration is first-user-only (see packages/auth/src/registration.ts).
 *      The very first thing this suite does is register that first account,
 *      via the "setup" project below, and every other project depends on it
 *      completing first. See tests/setup/first-run.setup.ts.
 *   2. No test may assume an empty database beyond that first step. Specs key
 *      on randomly generated emails/filenames (tests/fixtures/) so reruns
 *      against a warm database stay valid instead of colliding with rows a
 *      previous run left behind.
 */

const OWNER_STORAGE_STATE = "./.auth/owner.json";

export default defineConfig({
  testDir: "./tests",
  // Tests within one file run in declaration order, on one worker, by
  // default (fullyParallel is intentionally left off). The suite leans on
  // that: any spec that has to flip an installation-wide toggle (open
  // registration, see tests/admin-and-isolation.spec.ts) does every step
  // that depends on the toggle inside a single file so no other spec can
  // observe it mid-flight.
  fullyParallel: false,
  // One worker, so separate files cannot overlap either. `fullyParallel:
  // false` only serialises tests *within* a file; different files still run
  // concurrently, and that is not enough here. Every project signs in as the
  // same owner through OWNER_STORAGE_STATE, so while auth-flows.spec has
  // two-factor enrolled on that account any other file's sign-in lands on
  // /two-factor instead of /dashboard. Unlike the registration toggle, that
  // state cannot be contained inside one file, because the account it belongs
  // to is shared by all of them.
  //
  // This is a nightly suite of about thirty tests; determinism is worth more
  // than the parallelism.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // A cold container (fresh image pull, first request after `migrate
  // deploy`) is slower than a warm local dev server.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
    ["junit", { outputFile: "test-results/results.xml" }],
  ],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    // Playwright's screenshot modes don't include "on-first-retry" (that's
    // only a trace/video mode) — "on-first-failure" is the closest
    // equivalent: capture a screenshot the first time a test fails, which is
    // exactly the run a retry then repeats.
    screenshot: "on-first-failure",
    video: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testDir: "./tests/setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: OWNER_STORAGE_STATE },
      dependencies: ["setup"],
      testIgnore: /setup\//,
      // Chromium only for now. To add another engine, add a project here
      // with the matching `devices[...]` entry (e.g. "Desktop Firefox",
      // "Desktop Safari") — Playwright installs its own browser binaries per
      // engine, so also extend the `playwright install` command in the
      // README/CI workflow to include it.
    },
  ],
});
