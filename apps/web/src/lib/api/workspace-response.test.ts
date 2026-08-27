import { describe, expect, it } from "vitest";

import { workspaceError } from "@/lib/api/workspace-response";
import type { WorkspaceErrorReason } from "@/lib/workspace/result";

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
