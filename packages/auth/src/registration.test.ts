import { describe, expect, it } from "vitest";

import { canRegister } from "./registration";

describe("canRegister", () => {
  it("allows registration when there are zero users", () => {
    expect(canRegister(0, false)).toBe(true);
  });

  it("requires the registration setting once an account exists", () => {
    expect(canRegister(1, false)).toBe(false);
    expect(canRegister(5, false)).toBe(false);
    expect(canRegister(1, true)).toBe(true);
  });
});
