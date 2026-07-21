import { describe, expect, it } from "vitest";

import { canRegister } from "@/lib/registration";

describe("canRegister", () => {
  it("allows registration when there are zero users", () => {
    expect(canRegister(0)).toBe(true);
  });

  it("closes registration once at least one user exists", () => {
    expect(canRegister(1)).toBe(false);
    expect(canRegister(5)).toBe(false);
  });
});
