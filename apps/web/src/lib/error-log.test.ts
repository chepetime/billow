import { describe, expect, it } from "vitest";

import { redactSecrets, truncateStack } from "@/lib/error-log";

describe("redactSecrets", () => {
  it("masks the password in a connection string embedded in text", () => {
    const input =
      "connect ECONNREFUSED postgres://billow:s3cr3t@db:5432/billow";
    expect(redactSecrets(input)).toBe(
      "connect ECONNREFUSED postgres://billow:••••@db:5432/billow",
    );
  });

  it("masks every connection string when there is more than one", () => {
    const input =
      "primary postgres://a:pw1@host1/db then fallback postgres://b:pw2@host2/db";
    expect(redactSecrets(input)).toBe(
      "primary postgres://a:••••@host1/db then fallback postgres://b:••••@host2/db",
    );
  });

  it("masks a connection string with no password", () => {
    const input = "postgres://billow@db:5432/billow";
    expect(redactSecrets(input)).toBe("postgres://billow:••••@db:5432/billow");
  });

  it("leaves text with no connection string untouched", () => {
    const input = "TypeError: cannot read properties of undefined";
    expect(redactSecrets(input)).toBe(input);
  });
});

describe("truncateStack", () => {
  it("leaves a short stack untouched", () => {
    const stack = "Error: boom\n    at foo (file.ts:1:1)";
    expect(truncateStack(stack)).toBe(stack);
  });

  it("truncates a stack longer than the default limit and marks it", () => {
    const stack = "x".repeat(10_050);
    const result = truncateStack(stack);
    expect(result.startsWith("x".repeat(10_000))).toBe(true);
    expect(result).toContain("[truncated]");
    expect(result.length).toBeLessThan(stack.length);
  });

  it("respects a custom max length", () => {
    const stack = "abcdefghij";
    expect(truncateStack(stack, 5)).toBe("abcde\n… [truncated]");
  });

  it("does not truncate a stack exactly at the limit", () => {
    const stack = "y".repeat(10_000);
    expect(truncateStack(stack)).toBe(stack);
  });
});
