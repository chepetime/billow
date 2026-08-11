import { describe, expect, it } from "vitest";

import {
  openBackupEntry,
  openBackupWithRecoveryKey,
  parseBackupEnvelope,
  sealBackupEntry,
  sealBackupWithRecoveryKey,
} from "./backup-envelope";
import { KeyHierarchyError } from "./key-hierarchy";

const RECOVERY_KEY = "K9F2-3JQM-7ZTB-XW04-HN5R-P8VC-2DGY-6SAE";
const MANIFEST = "backup.json";

describe("sealBackupWithRecoveryKey", () => {
  it("round-trips a content key through the recovery key", async () => {
    const { envelope, contentKey } =
      await sealBackupWithRecoveryKey(RECOVERY_KEY);

    expect(contentKey).toHaveLength(32);
    expect(await openBackupWithRecoveryKey(envelope, RECOVERY_KEY)).toEqual(
      contentKey,
    );
  });

  it("gives two exports different content keys and salts", async () => {
    const first = await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const second = await sealBackupWithRecoveryKey(RECOVERY_KEY);

    expect(first.contentKey).not.toEqual(second.contentKey);
    expect(first.envelope.salt).not.toEqual(second.envelope.salt);
  });

  it("never puts the recovery key or the content key in the envelope", async () => {
    const { envelope, contentKey } =
      await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const serialised = JSON.stringify(envelope);

    expect(serialised).not.toContain(RECOVERY_KEY);
    expect(serialised).not.toContain(contentKey.toString("base64url"));
  });
});

describe("openBackupWithRecoveryKey", () => {
  it("accepts a key retyped off paper with different case and separators", async () => {
    const { envelope, contentKey } =
      await sealBackupWithRecoveryKey(RECOVERY_KEY);

    const retyped = RECOVERY_KEY.toLowerCase().replaceAll("-", " ");
    expect(await openBackupWithRecoveryKey(envelope, retyped)).toEqual(
      contentKey,
    );
  });

  it("refuses the wrong recovery key", async () => {
    const { envelope } = await sealBackupWithRecoveryKey(RECOVERY_KEY);

    await expect(
      openBackupWithRecoveryKey(
        envelope,
        "0000-0000-0000-0000-0000-0000-0000-0000",
      ),
    ).rejects.toThrow(KeyHierarchyError);
  });

  it("refuses a tampered wrap", async () => {
    const { envelope } = await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const tampered = {
      ...envelope,
      contentKeyWrapped: `${envelope.contentKeyWrapped.slice(0, -2)}AA`,
    };

    await expect(
      openBackupWithRecoveryKey(tampered, RECOVERY_KEY),
    ).rejects.toThrow(KeyHierarchyError);
  });

  it("refuses a salt of the wrong length", async () => {
    const { envelope } = await sealBackupWithRecoveryKey(RECOVERY_KEY);

    await expect(
      openBackupWithRecoveryKey({ ...envelope, salt: "AAAA" }, RECOVERY_KEY),
    ).rejects.toThrow(KeyHierarchyError);
  });

  it("does not open one export's envelope with another's", async () => {
    const first = await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const second = await sealBackupWithRecoveryKey(RECOVERY_KEY);

    // Same recovery key, different salt: the wrap belongs to its own envelope.
    await expect(
      openBackupWithRecoveryKey(
        { ...first.envelope, salt: second.envelope.salt },
        RECOVERY_KEY,
      ),
    ).rejects.toThrow(KeyHierarchyError);
  });
});

describe("parseBackupEnvelope", () => {
  it("accepts an envelope this build wrote", async () => {
    const { envelope } = await sealBackupWithRecoveryKey(RECOVERY_KEY);

    expect(parseBackupEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(
      envelope,
    );
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["a future version", { version: "v2", kdf: "scrypt", salt: "a", w: "b" }],
    ["an unknown kdf", { version: "v1", kdf: "argon2", salt: "a", w: "b" }],
    ["a missing wrap", { version: "v1", kdf: "scrypt", salt: "a" }],
  ])("rejects %s", (_label, value) => {
    expect(parseBackupEnvelope(value)).toBeNull();
  });
});

describe("sealBackupEntry", () => {
  it("round-trips bytes under the entry name they were sealed with", async () => {
    const { contentKey } = await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const plaintext = Buffer.from('{"formatVersion":2}', "utf8");

    const sealed = sealBackupEntry(contentKey, MANIFEST, plaintext);

    expect(sealed).not.toEqual(plaintext);
    expect(sealed.toString("utf8")).not.toContain("formatVersion");
    expect(openBackupEntry(contentKey, MANIFEST, sealed)).toEqual(plaintext);
  });

  it("seals an empty entry", async () => {
    const { contentKey } = await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const sealed = sealBackupEntry(contentKey, "files/0000", Buffer.alloc(0));

    expect(openBackupEntry(contentKey, "files/0000", sealed)).toHaveLength(0);
  });

  it("refuses to open an entry moved to another entry name", async () => {
    const { contentKey } = await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const sealed = sealBackupEntry(
      contentKey,
      "files/0003",
      Buffer.from("payslip", "utf8"),
    );

    expect(() => openBackupEntry(contentKey, "files/0000", sealed)).toThrow(
      KeyHierarchyError,
    );
  });

  it("refuses a file substituted for the manifest", async () => {
    const { contentKey } = await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const sealed = sealBackupEntry(
      contentKey,
      "files/0000",
      Buffer.from("{}", "utf8"),
    );

    expect(() => openBackupEntry(contentKey, MANIFEST, sealed)).toThrow(
      KeyHierarchyError,
    );
  });

  it("refuses flipped ciphertext bits", async () => {
    const { contentKey } = await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const sealed = sealBackupEntry(
      contentKey,
      MANIFEST,
      Buffer.from("payload", "utf8"),
    );
    sealed[sealed.length - 1] ^= 0xff;

    expect(() => openBackupEntry(contentKey, MANIFEST, sealed)).toThrow(
      KeyHierarchyError,
    );
  });

  it("refuses another export's content key", async () => {
    const first = await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const second = await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const sealed = sealBackupEntry(
      first.contentKey,
      MANIFEST,
      Buffer.from("payload", "utf8"),
    );

    expect(() => openBackupEntry(second.contentKey, MANIFEST, sealed)).toThrow(
      KeyHierarchyError,
    );
  });

  it("refuses a truncated entry rather than reading past it", async () => {
    const { contentKey } = await sealBackupWithRecoveryKey(RECOVERY_KEY);

    expect(() =>
      openBackupEntry(contentKey, MANIFEST, Buffer.alloc(8)),
    ).toThrow(KeyHierarchyError);
  });
});
