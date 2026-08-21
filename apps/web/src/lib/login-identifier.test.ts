import { describe, expect, it } from "vitest";

import { isEmailIdentifier } from "@/lib/login-identifier";

describe("isEmailIdentifier", () => {
  it("treats values containing @ as emails", () => {
    expect(isEmailIdentifier("alex@billow.test")).toBe(true);
  });

  it("treats plain handles as usernames", () => {
    expect(isEmailIdentifier("alex")).toBe(false);
    expect(isEmailIdentifier("alex.doe_1")).toBe(false);
  });

  it("handles the empty string as a username", () => {
    expect(isEmailIdentifier("")).toBe(false);
  });
});
