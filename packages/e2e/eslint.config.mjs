// This package is a standalone Playwright test suite, not a Next.js app or a
// React library, so it deliberately does not extend
// @billow/eslint-config/next (that config pulls in eslint-plugin-react,
// jsx-a11y and Next-specific rules that don't apply to .spec.ts files and
// would just add noise). Instead this is a plain typescript-eslint setup plus
// eslint-plugin-playwright, which catches the mistakes that actually matter
// in Playwright specs (missing awaits on expect/locator calls, conditional
// assertions, focused/skipped tests left behind, etc).
//
// packages/db, packages/auth, packages/ui and packages/shadcn take the
// opposite, equally deliberate choice: they have no "lint" script at all, so
// `turbo lint` (and therefore `pnpm run lint`) silently skips them. This
// package chooses to lint because test code regresses just like app code.
import js from "@eslint/js";
import playwright from "eslint-plugin-playwright";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "playwright-report/**",
    "test-results/**",
    ".auth/**",
    "node_modules/**",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    plugins: { playwright },
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      // tests/setup/first-run.setup.ts splits one long test into named
      // helper functions for readability; their `expect()` calls are real,
      // this rule's static analysis just doesn't look inside a called
      // function by default.
      "playwright/expect-expect": [
        "warn",
        {
          assertFunctionNames: [
            "landingPageOffersRegistration",
            "registerLandsOnDashboard",
            "secondSignUpIsRejected",
          ],
        },
      ],
    },
  },
]);
