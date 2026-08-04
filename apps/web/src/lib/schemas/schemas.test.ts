import { describe, expect, it } from "vitest";

import { profileSchema } from "@/lib/schemas/account";
import { signInSchema, signUpSchema, usernameSchema } from "@/lib/schemas/auth";

describe("signInSchema", () => {
  it("accepts a username or an email as the identifier", () => {
    expect(
      signInSchema.safeParse({ identifier: "chepe", password: "x" }).success,
    ).toBe(true);
    expect(
      signInSchema.safeParse({ identifier: "a@b.co", password: "x" }).success,
    ).toBe(true);
  });

  it("rejects an empty identifier", () => {
    expect(
      signInSchema.safeParse({ identifier: "", password: "x" }).success,
    ).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("requires a valid email and an 8+ character password", () => {
    expect(
      signUpSchema.safeParse({
        name: "Jose",
        email: "alex@billow.test",
        password: "supersecret",
      }).success,
    ).toBe(true);
  });

  it("rejects short passwords", () => {
    const result = signUpSchema.safeParse({
      name: "Jose",
      email: "alex@billow.test",
      password: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed emails", () => {
    expect(
      signUpSchema.safeParse({
        name: "Jose",
        email: "not-an-email",
        password: "supersecret",
      }).success,
    ).toBe(false);
  });
});

describe("usernameSchema", () => {
  it("accepts safe handles", () => {
    expect(usernameSchema.safeParse("jose.lugo_1-x").success).toBe(true);
  });

  it("rejects spaces and symbols", () => {
    expect(usernameSchema.safeParse("jose lugo").success).toBe(false);
    expect(usernameSchema.safeParse("jose@lugo").success).toBe(false);
  });

  it("rejects handles that are too short", () => {
    expect(usernameSchema.safeParse("ab").success).toBe(false);
  });
});

describe("profileSchema", () => {
  it("treats an empty username as valid (unset)", () => {
    expect(
      profileSchema.safeParse({ name: "Jose", username: "" }).success,
    ).toBe(true);
  });

  it("still validates a non-empty username", () => {
    expect(
      profileSchema.safeParse({ name: "Jose", username: "no spaces" }).success,
    ).toBe(false);
  });
});
