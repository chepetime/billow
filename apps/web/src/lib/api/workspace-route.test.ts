import { describe, expect, it } from "vitest";

import { numericId, workspaceError } from "@/lib/api/workspace-route";
import type { WorkspaceErrorReason } from "@/lib/workspace/rule";

/**
 * The mapper is the API's half of the rules split: `lib/workspace/*` returns a
 * reason, this turns it into a status, and `lib/actions/*` turns the same
 * reason into form copy. What matters is that every reason has a deliberate
 * status — a refusal silently becoming 500 is the failure this guards.
 */
const EXPECTED: Record<WorkspaceErrorReason, number> = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
  in_use: 409,
  no_key: 409,
  failed: 500,
};

describe("workspaceError", () => {
  it.each(Object.entries(EXPECTED))("maps %s to %i", (reason, status) => {
    const response = workspaceError({
      ok: false,
      reason: reason as WorkspaceErrorReason,
    });
    expect(response.status).toBe(status);
  });

  it("does not answer no_key with 401", async () => {
    // The credential is valid; the value is sealed under the owner's data key
    // and no API key can reach it. A 401 would send a caller off to re-issue a
    // key that was never the problem.
    const response = workspaceError({ ok: false, reason: "no_key" });
    expect(response.status).not.toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("signed in"),
    });
  });

  it("passes field errors through on an invalid refusal", async () => {
    const response = workspaceError({
      ok: false,
      reason: "invalid",
      fields: { email: ["Enter a valid email address."] },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request.",
      fields: { email: ["Enter a valid email address."] },
    });
  });

  it("still answers 400 when an invalid refusal carries no fields", async () => {
    const response = workspaceError({ ok: false, reason: "invalid" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request.",
      fields: {},
    });
  });
});

describe("numericId", () => {
  it("accepts a serial id", () => {
    expect(numericId("42")).toBe(42);
  });

  it.each([
    ["an empty segment", ""],
    ["whitespace", " "],
    ["a word", "abc"],
    ["a decimal", "1.5"],
    // Number() accepts all three of these, which is why the check is a regex
    // and not Number.isInteger: hex would give two URLs for one row, and the
    // empty and blank cases would look up the nonexistent id 0.
    ["hex", "0x10"],
    ["exponent notation", "1e3"],
    ["a leading plus", "+1"],
    ["a negative", "-1"],
    ["zero, which no serial id ever is", "0"],
    ["a padded number", " 12 "],
  ])("rejects %s", (_label, raw) => {
    expect(numericId(raw)).toBeNull();
  });

  it("accepts a large id without losing precision", () => {
    expect(numericId("2147483647")).toBe(2147483647);
  });
});
