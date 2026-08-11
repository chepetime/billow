import { gunzipSync, gzipSync } from "node:zlib";
import {
  openBackupEntry,
  openBackupWithRecoveryKey,
  parseBackupEnvelope,
  sealBackupEntry,
  sealBackupWithRecoveryKey,
} from "@billow/crypto";
import { describe, expect, it } from "vitest";

import { readTar, type TarEntrySource, writeTar } from "./backup-archive";
import { ENVELOPE_ENTRY, MANIFEST_ENTRY } from "./backup-format";

const RECOVERY_KEY = "K9F2-3JQM-7ZTB-XW04-HN5R-P8VC-2DGY-6SAE";

async function collect(entries: TarEntrySource[]): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of writeTar(entries)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function entry(name: string, body: Buffer): TarEntrySource {
  return { name, size: body.byteLength, body: () => [body] };
}

const LIMIT = 10 * 1024 * 1024;

describe("backup archive", () => {
  it("round-trips entries byte for byte", async () => {
    const manifest = Buffer.from(JSON.stringify({ formatVersion: 2 }), "utf8");
    // Deliberately not block-aligned: 512-byte padding is where a hand-written
    // tar most easily corrupts the *following* entry rather than itself.
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
    ]);

    const archive = await collect([
      entry("backup.json", manifest),
      entry("files/0000", png),
    ]);
    const read = readTar(archive, LIMIT);

    expect(read.map((e) => e.name)).toEqual(["backup.json", "files/0000"]);
    expect(read[0]!.body.equals(manifest)).toBe(true);
    expect(read[1]!.body.equals(png)).toBe(true);
  });

  it("preserves content across an exactly block-sized entry", async () => {
    const aligned = Buffer.alloc(512, 0x41);
    const after = Buffer.from("after", "utf8");

    const read = readTar(
      await collect([entry("files/0000", aligned), entry("files/0001", after)]),
      LIMIT,
    );

    expect(read[0]!.body.byteLength).toBe(512);
    expect(read[1]!.body.toString("utf8")).toBe("after");
  });

  it("handles an empty entry without swallowing the next one", async () => {
    const read = readTar(
      await collect([
        entry("files/0000", Buffer.alloc(0)),
        entry("files/0001", Buffer.from("kept", "utf8")),
      ]),
      LIMIT,
    );

    expect(read).toHaveLength(2);
    expect(read[1]!.body.toString("utf8")).toBe("kept");
  });

  it("rejects an entry whose body does not match its declared size", async () => {
    await expect(
      collect([
        {
          name: "files/0000",
          size: 99,
          body: () => [Buffer.from("short", "utf8")],
        },
      ]),
    ).rejects.toThrow(/declared 99 bytes but produced 5/);
  });

  it("refuses an archive larger than the caller allows", async () => {
    const archive = await collect([entry("files/0000", Buffer.alloc(4096, 7))]);
    expect(() => readTar(archive, 1024)).toThrow(
      /larger than this installation/,
    );
  });

  it("refuses a truncated archive rather than returning partial bytes", async () => {
    const archive = await collect([entry("files/0000", Buffer.alloc(2048, 9))]);
    expect(() => readTar(archive.subarray(0, 900), LIMIT)).toThrow(/truncated/);
  });

  it("stops at the end-of-archive marker", async () => {
    const archive = await collect([
      entry("files/0000", Buffer.from("x", "utf8")),
    ]);
    // Trailing zeros beyond the marker (as real tar implementations emit) must
    // not be read back as further entries.
    const padded = Buffer.concat([archive, Buffer.alloc(4096)]);
    expect(readTar(padded, LIMIT)).toHaveLength(1);
  });

  it("carries sealed entries through gzip unchanged", async () => {
    const { contentKey, envelope } =
      await sealBackupWithRecoveryKey(RECOVERY_KEY);
    const manifest = Buffer.from(JSON.stringify({ formatVersion: 2 }), "utf8");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const header = Buffer.from(JSON.stringify(envelope), "utf8");

    // The whole export path in miniature: seal each entry, write the tar,
    // gzip, then read it back the way the restore endpoint does. Ciphertext is
    // arbitrary binary of an odd length, which is exactly what a hand-written
    // tar's 512-byte padding gets wrong if it gets anything wrong.
    const archive = gzipSync(
      await collect([
        entry(ENVELOPE_ENTRY, header),
        entry(
          MANIFEST_ENTRY,
          sealBackupEntry(contentKey, MANIFEST_ENTRY, manifest),
        ),
        entry("files/0000", sealBackupEntry(contentKey, "files/0000", png)),
      ]),
    );

    const read = readTar(gunzipSync(archive), LIMIT);
    const byName = new Map(read.map((e) => [e.name, e.body]));

    const parsed = parseBackupEnvelope(
      JSON.parse(byName.get(ENVELOPE_ENTRY)!.toString("utf8")),
    );
    expect(parsed).not.toBeNull();

    const recovered = await openBackupWithRecoveryKey(parsed!, RECOVERY_KEY);

    expect(
      openBackupEntry(recovered, MANIFEST_ENTRY, byName.get(MANIFEST_ENTRY)!),
    ).toEqual(manifest);
    expect(
      openBackupEntry(recovered, "files/0000", byName.get("files/0000")!),
    ).toEqual(png);
  });
});
