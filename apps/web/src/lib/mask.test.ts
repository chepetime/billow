import { describe, expect, it } from "vitest";

import { maskAccountNumber } from "@/lib/mask";

describe("maskAccountNumber", () => {
  it("shows only the last four digits", () => {
    expect(maskAccountNumber("012345678901234567")).toBe("•••• 4567");
  });

  it("says Locked rather than masking ciphertext", () => {
    // Without this the tail of an AES envelope renders as though it were the
    // last four digits of the account.
    expect(maskAccountNumber("encv1.aBcD.eFgH.iJkLmNoP")).toBe("Locked");
  });

  it("never reveals a short value", () => {
    expect(maskAccountNumber("1234")).toBe("••••");
    expect(maskAccountNumber("12")).toBe("••••");
  });

  it("returns nothing for an empty value", () => {
    expect(maskAccountNumber("")).toBe("");
    expect(maskAccountNumber("   ")).toBe("");
  });
});
