import { describe, expect, it } from "vitest";

import {
  decryptVaultPayload,
  encryptVaultPayload,
  VaultCryptoError,
} from "@/lib/vault-crypto";

describe("experimental vault encryption", () => {
  const ownerId = "owner-id";
  const key = "correct horse battery staple";
  const secret = "a note that must not appear in the database";

  it("round-trips while keeping plaintext and key out of ciphertext", async () => {
    const ciphertext = await encryptVaultPayload(ownerId, key, secret);

    expect(ciphertext).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(ciphertext).not.toContain(secret);
    expect(ciphertext).not.toContain(key);
    await expect(decryptVaultPayload(ownerId, key, ciphertext)).resolves.toBe(
      secret,
    );
  });

  it("rejects a wrong key and a ciphertext copied to another user", async () => {
    const ciphertext = await encryptVaultPayload(ownerId, key, secret);

    await expect(
      decryptVaultPayload(ownerId, "wrong key", ciphertext),
    ).rejects.toBeInstanceOf(VaultCryptoError);
    await expect(
      decryptVaultPayload("other-user-id", key, ciphertext),
    ).rejects.toBeInstanceOf(VaultCryptoError);
  });
});
