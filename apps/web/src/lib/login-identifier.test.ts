import { describe, expect, it } from "vitest";

import { isEmailIdentifier } from "@/lib/login-identifier";

describe("isEmailIdentifier", () => {
  it("treats values containing @ as emails", () => {
    expect(isEmailIdentifier("alex@billow.test")).toBe(true);
  });

  it("treats plain handles as usernames", () => {
    expect(isEmailIdentifier("jose")).toBe(false);
    expect(isEmailIdentifier("jose.lugo_1")).toBe(false);
  });

  it("handles the empty string as a username", () => {
    expect(isEmailIdentifier("")).toBe(false);
  });
});
