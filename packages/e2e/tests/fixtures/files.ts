/**
 * Byte-level fixtures for the uploads flow (see tests/uploads.spec.ts).
 *
 * These are built in memory rather than committed as binary files in the
 * repo: Playwright's `setInputFiles`/`multipart` APIs both accept an
 * in-memory `{ name, mimeType, buffer }` triple directly, so there is no
 * need for real files on disk, and nothing binary needs to be tracked by git.
 */

/** A genuine, minimal 1x1 transparent PNG (67 bytes). Real PNG bytes, not just a spoofed magic number. */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export function validPngFile(name = "billow-e2e.png") {
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
  };
}

/**
 * Bytes that do not match any of the magic numbers `detectType` (see
 * apps/web/src/lib/storage.ts) accepts — plain text, not a spoofed image.
 * Named with a `.png` extension anyway: the server ignores the declared
 * filename/content-type and sniffs the real bytes, so this must still be
 * rejected.
 */
export function invalidTypeFile(name = "not-really-an-image.png") {
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(
      "This is a plain text file pretending to be a PNG. Billow E2E fixture.",
      "utf-8",
    ),
  };
}
