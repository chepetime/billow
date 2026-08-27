import { describe, expect, it } from "vitest";

import {
  allows,
  describeGrant,
  grantOf,
  permissionsFor,
} from "@/lib/api/api-key-scope";

describe("permissionsFor", () => {
  it("stores read and write explicitly for a read_write grant", () => {
    expect(permissionsFor("read_write")).toEqual({
      billow: ["read", "write"],
    });
  });

  it("stores only read for a read grant", () => {
    expect(permissionsFor("read")).toEqual({ billow: ["read"] });
  });

  it("round-trips through grantOf", () => {
    expect(grantOf(permissionsFor("read"))).toBe("read");
    expect(grantOf(permissionsFor("read_write"))).toBe("read_write");
  });
});

describe("allows", () => {
  it("lets a read_write key write", () => {
    expect(allows(permissionsFor("read_write"), "write")).toBe(true);
  });

  it("refuses a write to a read-only key", () => {
    expect(allows(permissionsFor("read"), "write")).toBe(false);
  });

  it("lets any key read", () => {
    expect(allows(permissionsFor("read"), "read")).toBe(true);
    expect(allows(permissionsFor("read_write"), "read")).toBe(true);
  });
});

/**
 * A key with no permissions is the case BetterAuth handles worst: it refuses
 * every permission check outright, and reports the refusal as KEY_NOT_FOUND —
 * a 401 reading "invalid key" for a key that is perfectly valid. These keys
 * exist because authClient.apiKey.create sets no permissions and is reachable
 * from a browser console.
 */
describe("a key with no scopes", () => {
  it.each([
    null,
    undefined,
    {},
    { billow: [] },
    "nonsense",
    { other: ["write"] },
  ])("reads but does not write: %j", (permissions) => {
    expect(allows(permissions, "read")).toBe(true);
    expect(allows(permissions, "write")).toBe(false);
    expect(grantOf(permissions)).toBe("read");
  });

  it("ignores non-string entries rather than throwing", () => {
    expect(allows({ billow: [1, null, "write"] }, "write")).toBe(true);
    expect(allows({ billow: [1, null] }, "write")).toBe(false);
  });
});

describe("describeGrant", () => {
  it("names both grants for the settings list", () => {
    expect(describeGrant("read")).toBe("Read only");
    expect(describeGrant("read_write")).toBe("Read and write");
  });
});
