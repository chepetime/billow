import { createHmac } from "node:crypto";

/**
 * A minimal RFC 6238 TOTP generator, enough to act as the authenticator app
 * during two-factor enrolment.
 *
 * Written here rather than pulled in as a dependency: this is the only place
 * the suite needs it, the algorithm is fixed, and a test that proves our 2FA
 * works should not lean on a library that could paper over a mismatch in
 * digits, period, or algorithm. BetterAuth's twoFactor plugin issues standard
 * SHA-1 / 6-digit / 30-second codes, which is what the defaults below encode.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decode an unpadded RFC 4648 base32 string, as used in `otpauth://` URIs. */
export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

/** Pull the shared secret out of an `otpauth://totp/...?secret=...` URI. */
export function secretFromUri(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) {
    throw new Error(`No secret in otpauth URI: ${uri}`);
  }
  return secret;
}

/**
 * The current 6-digit code for a base32 secret.
 *
 * `stepOffset` shifts by whole 30-second periods, which the spec uses to prove
 * that a code from a different window is rejected.
 */
export function totp(
  secret: string,
  { stepOffset = 0, period = 30, digits = 6 } = {},
): string {
  const counter = Math.floor(Date.now() / 1000 / period) + stepOffset;

  // The counter is a 64-bit big-endian integer. Written as two 32-bit halves
  // because a JS bitwise shift would truncate to 32 bits.
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBytes.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", base32Decode(secret))
    .update(counterBytes)
    .digest();

  // Dynamic truncation (RFC 4226 §5.3): the low nibble of the last byte picks
  // the offset to read four bytes from, and the top bit is masked off.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/**
 * Seconds left in the current period.
 *
 * Used to avoid submitting a code that expires mid-request, which is the one
 * way a correct implementation of this test can still flake.
 */
export function secondsRemainingInPeriod(period = 30): number {
  return period - (Math.floor(Date.now() / 1000) % period);
}
