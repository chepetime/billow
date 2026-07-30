import "server-only";

/**
 * A minimal streaming tar (ustar) reader and writer for backup archives.
 *
 * Why tar, and why hand-written:
 *
 * The obvious approach — base64 the uploaded files into the existing JSON —
 * cannot work here. The per-account upload quota is 100 MB
 * (MAX_UPLOADS_PER_USER_BYTES) and the production container runs with
 * `--max-old-space-size=128`. Base64 inflates by a third, so a full account
 * would need ~133 MB of contiguous string on a 128 MB heap: it would OOM
 * exactly when someone has real data to protect, which is the worst possible
 * time. Tar entries are written and read as a stream, so peak memory is one
 * file rather than all of them.
 *
 * Tar rather than zip because a zip's central directory has to be written
 * after the entries and patched with offsets, while tar is a flat sequence of
 * 512-byte header + padded payload. That difference is the whole reason this
 * is ~100 lines and has no dependency.
 *
 * Security note: entry names produced by `writeTar` are generated
 * (`files/0000`), never user-supplied, and `readTar` hands names back to the
 * caller as opaque strings. Nothing here resolves an entry name to a
 * filesystem path, so the classic tar path-traversal ("../../etc/passwd" as a
 * member name) has no reachable sink.
 */

const BLOCK_SIZE = 512;

export type TarEntrySource = {
  name: string;
  size: number;
  /** Yields the entry's bytes. Called once, lazily, while streaming. */
  body: () => AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
};

function padTo(value: string, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  buffer.write(value, 0, "utf8");
  return buffer;
}

/** Octal with a trailing NUL, which is how tar encodes numeric header fields. */
function octal(value: number, length: number): Buffer {
  const text = value.toString(8).padStart(length - 1, "0");
  return padTo(text, length);
}

function header(name: string, size: number): Buffer {
  const block = Buffer.alloc(BLOCK_SIZE);

  padTo(name, 100).copy(block, 0);
  octal(0o644, 8).copy(block, 100); // mode
  octal(0, 8).copy(block, 108); // uid
  octal(0, 8).copy(block, 116); // gid
  octal(size, 12).copy(block, 124);
  octal(Math.floor(Date.now() / 1000), 12).copy(block, 136); // mtime
  block.write("0", 156); // type flag: regular file
  padTo("ustar\0", 8).copy(block, 257); // magic + version

  // The checksum is computed with its own field treated as spaces, then
  // written into that field. Getting this wrong makes archives that `tar`
  // refuses to read even though every other byte is correct.
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  octal(sum, 8).copy(block, 148);

  return block;
}

function padding(size: number): Buffer {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK_SIZE - remainder);
}

/**
 * Stream `entries` as a tar archive.
 *
 * Each entry's declared `size` must match what its body yields — tar has no
 * way to express "length unknown", and a mismatch silently corrupts every
 * following entry, so this throws instead.
 */
export async function* writeTar(
  entries: Iterable<TarEntrySource> | AsyncIterable<TarEntrySource>,
): AsyncGenerator<Uint8Array> {
  for await (const entry of entries) {
    yield header(entry.name, entry.size);

    let written = 0;
    for await (const chunk of entry.body()) {
      written += chunk.byteLength;
      yield chunk;
    }

    if (written !== entry.size) {
      throw new Error(
        `Archive entry "${entry.name}" declared ${entry.size} bytes but produced ${written}.`,
      );
    }

    const pad = padding(entry.size);
    if (pad.byteLength > 0) yield pad;
  }

  // Two zero blocks mark end-of-archive.
  yield Buffer.alloc(BLOCK_SIZE * 2);
}

export type TarEntry = { name: string; body: Buffer };

/**
 * Parse a complete tar archive held in memory.
 *
 * Reading is not streamed, unlike writing. A restore has to validate the
 * manifest before it can decide what any file entry means, and the upload
 * cap (10 MB per file, 100 MB per account) bounds what this can be asked to
 * hold. `maxTotalBytes` is enforced so a hostile archive cannot be used to
 * exhaust memory regardless.
 */
export function readTar(buffer: Buffer, maxTotalBytes: number): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let total = 0;

  while (offset + BLOCK_SIZE <= buffer.byteLength) {
    const block = buffer.subarray(offset, offset + BLOCK_SIZE);

    // A zero block is end-of-archive; trailing padding may follow.
    if (block.every((byte) => byte === 0)) break;

    const name = block.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeField = block.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeField, 8);

    if (!Number.isFinite(size) || size < 0) {
      throw new Error("Backup archive is malformed: unreadable entry size.");
    }

    total += size;
    if (total > maxTotalBytes) {
      throw new Error("Backup archive is larger than this installation accepts.");
    }

    const start = offset + BLOCK_SIZE;
    const end = start + size;
    if (end > buffer.byteLength) {
      throw new Error("Backup archive is truncated.");
    }

    entries.push({ name, body: buffer.subarray(start, end) });
    offset = end + padding(size).byteLength;
  }

  return entries;
}
