import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CredentialCryptoError,
  decryptCredential,
  encryptCredential,
  previewCredential,
} from "./crypto";

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

describe("credential encryption", () => {
  beforeEach(() => {
    process.env["BETTER_AUTH_SECRET"] = SECRET;
  });

  afterEach(() => {
    delete process.env["BETTER_AUTH_SECRET"];
  });

  it("round-trips a credential", () => {
    const key = "re_1234567890abcdefghij";
    expect(decryptCredential(encryptCredential(key))).toBe(key);
  });

  it("never stores the plaintext in the ciphertext", () => {
    const key = "re_1234567890abcdefghij";
    expect(encryptCredential(key)).not.toContain(key);
  });

  it("produces a different ciphertext each time", () => {
    // A fresh IV per encryption: identical keys must not produce identical
    // rows, or a backup would leak that two installs share a credential.
    const key = "re_1234567890abcdefghij";
    expect(encryptCredential(key)).not.toBe(encryptCredential(key));
  });

  it("refuses to encrypt an empty credential", () => {
    expect(() => encryptCredential("")).toThrow(CredentialCryptoError);
  });

  it("fails closed when BETTER_AUTH_SECRET is absent", () => {
    delete process.env["BETTER_AUTH_SECRET"];
    expect(() => encryptCredential("re_abc")).toThrow(CredentialCryptoError);
  });

  it("cannot decrypt with a rotated secret", () => {
    const stored = encryptCredential("re_1234567890abcdefghij");
    process.env["BETTER_AUTH_SECRET"] = OTHER_SECRET;
    expect(() => decryptCredential(stored)).toThrow(CredentialCryptoError);
  });

  it("rejects tampered ciphertext", () => {
    // GCM authenticates: flipping a byte must fail loudly rather than
    // returning garbage that gets sent to a provider as a credential.
    const stored = encryptCredential("re_1234567890abcdefghij");
    const [iv, tag, ciphertext] = stored.split(".") as [string, string, string];
    const flipped = ciphertext.startsWith("A")
      ? `B${ciphertext.slice(1)}`
      : `A${ciphertext.slice(1)}`;

    expect(() => decryptCredential([iv, tag, flipped].join("."))).toThrow(
      CredentialCryptoError,
    );
  });

  it.each([
    ["", "empty"],
    ["not-a-credential", "no separators"],
    ["a.b", "too few segments"],
    ["a.b.c.d", "too many segments"],
    ["AAAA.BBBB.CCCC", "wrong iv and tag lengths"],
  ])("rejects malformed stored value (%s)", (stored) => {
    expect(() => decryptCredential(stored)).toThrow(CredentialCryptoError);
  });
});

describe("previewCredential", () => {
  it("keeps the provider prefix and last four characters", () => {
    expect(previewCredential("re_1234567890abcdefghij")).toBe("re_••••ghij");
  });

  it("masks a short value entirely", () => {
    expect(previewCredential("re_12")).toBe("••••");
  });

  it("never reveals the middle of the credential", () => {
    const key = "re_secretmiddlepart1234";
    expect(previewCredential(key)).not.toContain("secretmiddlepart");
  });

  it("handles a value with no prefix", () => {
    expect(previewCredential("1234567890abcdef")).toBe("••••cdef");
  });
});
