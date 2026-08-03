import { describe, expect, it } from "vitest";

import {
  KeyHierarchyError,
  beginSession,
  changePassword,
  createUserKeyset,
  decryptField,
  encryptField,
  isEncryptedField,
  issueRecoveryKey,
  resetPasswordWithRecoveryKey,
  resumeSession,
  unlockWithPassword,
  unlockWithRecoveryKey,
} from "./key-hierarchy";

const USER = "user_alice";
const PASSWORD = "correct horse battery staple";

/** A keyset that has been through onboarding, as most of these tests need. */
async function enrolled(userId = USER, password = PASSWORD) {
  const { keyset, dataKey } = await createUserKeyset(userId, password);
  const issued = await issueRecoveryKey(userId, keyset, dataKey);

  return { keyset: issued.keyset, recoveryKey: issued.recoveryKey, dataKey };
}

describe("createUserKeyset", () => {
  it("issues a 32-byte data key that the password unlocks again", async () => {
    const { keyset, dataKey } = await createUserKeyset(USER, PASSWORD);

    expect(dataKey).toHaveLength(32);
    expect(await unlockWithPassword(USER, keyset, PASSWORD)).toEqual(dataKey);
  });

  it("starts without a recovery arm, because nobody has been shown a key yet", async () => {
    const { keyset } = await createUserKeyset(USER, PASSWORD);

    expect(keyset.recoverySalt).toBeNull();
    expect(keyset.dataKeyWrappedByRecoveryKey).toBeNull();
  });

  it("gives two users different data keys for the same password", async () => {
    const alice = await createUserKeyset(USER, PASSWORD);
    const bob = await createUserKeyset("user_bob", PASSWORD);

    expect(alice.dataKey).not.toEqual(bob.dataKey);
  });
});

describe("unlockWithPassword", () => {
  it("refuses a wrong password", async () => {
    const { keyset } = await createUserKeyset(USER, PASSWORD);

    await expect(unlockWithPassword(USER, keyset, "wrong password")).rejects.toThrow(
      KeyHierarchyError,
    );
  });

  it("refuses a keyset lifted into another user's row", async () => {
    const { keyset } = await createUserKeyset(USER, PASSWORD);

    await expect(unlockWithPassword("user_mallory", keyset, PASSWORD)).rejects.toThrow(
      KeyHierarchyError,
    );
  });

  it("refuses a tampered wrap", async () => {
    const { keyset } = await createUserKeyset(USER, PASSWORD);
    const [version, iv, tag, wrapped] = keyset.dataKeyWrappedByPassword.split(".");
    const flipped = Buffer.from(wrapped!, "base64url");
    flipped[0] ^= 0xff;

    await expect(
      unlockWithPassword(
        USER,
        {
          ...keyset,
          dataKeyWrappedByPassword: [version, iv, tag, flipped.toString("base64url")].join("."),
        },
        PASSWORD,
      ),
    ).rejects.toThrow(KeyHierarchyError);
  });

  it("reports the same message however the unlock failed", async () => {
    const { keyset } = await createUserKeyset(USER, PASSWORD);
    const failures = await Promise.all(
      [
        unlockWithPassword(USER, keyset, "wrong password"),
        unlockWithPassword("user_mallory", keyset, PASSWORD),
        unlockWithPassword(USER, { ...keyset, dataKeyWrappedByPassword: "v1.a.b.c" }, PASSWORD),
      ].map((attempt) => attempt.then(() => "resolved").catch((error: Error) => error.message)),
    );

    expect(new Set(failures).size).toBe(1);
  });
});

describe("issueRecoveryKey", () => {
  it("is issued in readable groups drawn from an unambiguous alphabet", async () => {
    const { recoveryKey } = await enrolled();

    expect(recoveryKey).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
  });

  it("unlocks the same data key the password does", async () => {
    const { keyset, dataKey, recoveryKey } = await enrolled();

    expect(await unlockWithRecoveryKey(USER, keyset, recoveryKey)).toEqual(dataKey);
  });

  it("needs only the data key, so onboarding can run without the password", async () => {
    const { keyset, dataKey } = await createUserKeyset(USER, PASSWORD);

    const issued = await issueRecoveryKey(USER, keyset, dataKey);

    expect(await unlockWithRecoveryKey(USER, issued.keyset, issued.recoveryKey)).toEqual(dataKey);
  });

  it("replaces a previous key, so an unconfirmed one can be regenerated", async () => {
    const first = await enrolled();

    const second = await issueRecoveryKey(USER, first.keyset, first.dataKey);

    expect(second.recoveryKey).not.toEqual(first.recoveryKey);
    expect(await unlockWithRecoveryKey(USER, second.keyset, second.recoveryKey)).toEqual(
      first.dataKey,
    );
    await expect(unlockWithRecoveryKey(USER, second.keyset, first.recoveryKey)).rejects.toThrow(
      KeyHierarchyError,
    );
  });

  it("leaves the password arm untouched", async () => {
    const { keyset, dataKey } = await createUserKeyset(USER, PASSWORD);

    const issued = await issueRecoveryKey(USER, keyset, dataKey);

    expect(await unlockWithPassword(USER, issued.keyset, PASSWORD)).toEqual(dataKey);
  });
});

describe("unlockWithRecoveryKey", () => {
  it("refuses when onboarding never issued one", async () => {
    const { keyset } = await createUserKeyset(USER, PASSWORD);

    await expect(
      unlockWithRecoveryKey(USER, keyset, "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ"),
    ).rejects.toThrow(KeyHierarchyError);
  });

  it("accepts the key as a user would retype it", async () => {
    const { keyset, dataKey, recoveryKey } = await enrolled();
    const retyped = ` ${recoveryKey.toLowerCase().replaceAll("-", " ")} `;

    expect(await unlockWithRecoveryKey(USER, keyset, retyped)).toEqual(dataKey);
  });

  it("reads letters a user could confuse for digits", async () => {
    const { keyset, dataKey, recoveryKey } = await enrolled();
    const misread = recoveryKey.replaceAll("1", "I").replaceAll("0", "O");

    expect(await unlockWithRecoveryKey(USER, keyset, misread)).toEqual(dataKey);
  });

  it("refuses a recovery key from another account", async () => {
    const { keyset } = await enrolled();
    const other = await enrolled("user_bob");

    await expect(unlockWithRecoveryKey(USER, keyset, other.recoveryKey)).rejects.toThrow(
      KeyHierarchyError,
    );
  });
});

describe("changePassword", () => {
  const NEW_PASSWORD = "a completely different password";

  it("keeps the same data key, so stored data stays readable", async () => {
    const { keyset, dataKey } = await enrolled();

    const rewrapped = await changePassword(USER, keyset, PASSWORD, NEW_PASSWORD);

    expect(await unlockWithPassword(USER, rewrapped, NEW_PASSWORD)).toEqual(dataKey);
  });

  it("stops accepting the old password", async () => {
    const { keyset } = await enrolled();

    const rewrapped = await changePassword(USER, keyset, PASSWORD, NEW_PASSWORD);

    await expect(unlockWithPassword(USER, rewrapped, PASSWORD)).rejects.toThrow(KeyHierarchyError);
  });

  it("leaves the recovery key working", async () => {
    const { keyset, dataKey, recoveryKey } = await enrolled();

    const rewrapped = await changePassword(USER, keyset, PASSWORD, NEW_PASSWORD);

    expect(await unlockWithRecoveryKey(USER, rewrapped, recoveryKey)).toEqual(dataKey);
  });

  it("refuses to re-wrap without the current password", async () => {
    const { keyset } = await enrolled();

    await expect(changePassword(USER, keyset, "not the password", NEW_PASSWORD)).rejects.toThrow(
      KeyHierarchyError,
    );
  });
});

describe("resetPasswordWithRecoveryKey", () => {
  it("restores access to the same data key without the old password", async () => {
    const { keyset, dataKey, recoveryKey } = await enrolled();

    const rewrapped = await resetPasswordWithRecoveryKey(USER, keyset, recoveryKey, "chosen anew");

    expect(await unlockWithPassword(USER, rewrapped, "chosen anew")).toEqual(dataKey);
    expect(await unlockWithRecoveryKey(USER, rewrapped, recoveryKey)).toEqual(dataKey);
  });

  it("refuses a wrong recovery key", async () => {
    const { keyset } = await enrolled();

    await expect(
      resetPasswordWithRecoveryKey(USER, keyset, "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ", "x"),
    ).rejects.toThrow(KeyHierarchyError);
  });
});

describe("session re-wrap", () => {
  it("hands back the data key to the holder of the session key", async () => {
    const { dataKey } = await createUserKeyset(USER, PASSWORD);

    const session = await beginSession(USER, dataKey);

    expect(
      await resumeSession(USER, session.dataKeyWrappedBySessionKey, session.sessionKey),
    ).toEqual(dataKey);
  });

  it("gives every session its own key, so revoking one cannot open another", async () => {
    const { dataKey } = await createUserKeyset(USER, PASSWORD);

    const first = await beginSession(USER, dataKey);
    const second = await beginSession(USER, dataKey);

    expect(first.sessionKey).not.toEqual(second.sessionKey);
    await expect(
      resumeSession(USER, first.dataKeyWrappedBySessionKey, second.sessionKey),
    ).rejects.toThrow(KeyHierarchyError);
  });

  it("refuses a session wrap replayed into another account", async () => {
    const { dataKey } = await createUserKeyset(USER, PASSWORD);
    const session = await beginSession(USER, dataKey);

    await expect(
      resumeSession("user_mallory", session.dataKeyWrappedBySessionKey, session.sessionKey),
    ).rejects.toThrow(KeyHierarchyError);
  });

  it("refuses the password arm offered as a session wrap", async () => {
    const { keyset, dataKey } = await createUserKeyset(USER, PASSWORD);
    const session = await beginSession(USER, dataKey);

    await expect(
      resumeSession(USER, keyset.dataKeyWrappedByPassword, session.sessionKey),
    ).rejects.toThrow(KeyHierarchyError);
  });
});

describe("field encryption", () => {
  const dataKey = Buffer.alloc(32, 7);

  it("round-trips a value under the data key", async () => {
    const sealed = encryptField(dataKey, "BankAccount.iban", "GB33BUKB20201555555555");

    expect(sealed).not.toContain("GB33");
    expect(decryptField(dataKey, "BankAccount.iban", sealed)).toBe("GB33BUKB20201555555555");
  });

  it("gives a different ciphertext every write, so equal values do not look equal", () => {
    const a = encryptField(dataKey, "BankAccount.iban", "same");
    const b = encryptField(dataKey, "BankAccount.iban", "same");

    expect(a).not.toEqual(b);
  });

  it("refuses a value moved to another field", () => {
    const sealed = encryptField(dataKey, "BankAccount.iban", "GB33BUKB20201555555555");

    expect(() => decryptField(dataKey, "BankAccount.swift", sealed)).toThrow(KeyHierarchyError);
  });

  it("refuses another user's data key", () => {
    const sealed = encryptField(dataKey, "UserProfile.taxId", "TAX-1");

    expect(() => decryptField(Buffer.alloc(32, 9), "UserProfile.taxId", sealed)).toThrow(
      KeyHierarchyError,
    );
  });

  it("recognises its own ciphertext and nothing else", () => {
    expect(isEncryptedField(encryptField(dataKey, "UserProfile.taxId", "TAX-1"))).toBe(true);
    // Plaintext written before encryption shipped must be readable as itself.
    expect(isEncryptedField("TAX-1")).toBe(false);
    expect(isEncryptedField("enc.v1.not-really")).toBe(false);
  });
});
