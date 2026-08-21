/**
 * Masking for bank details in list and summary views.
 *
 * The requirement is that full payment instructions appear only when the user
 * takes an explicit action — opening an invoice, printing, exporting. Every
 * other surface shows this.
 */

/** The envelope prefix `@billow/crypto` writes. */
const ENVELOPE = "encv1.";

/**
 * Last four digits, or `Locked` when the value never got decrypted.
 *
 * The second case is the one worth having: a request without a data key reads
 * ciphertext, and `•••• Yg3w` — the tail of an AES envelope — looks exactly
 * like a real masked account number while meaning nothing.
 */
export function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.startsWith(ENVELOPE)) return "Locked";

  const trimmed = accountNumber.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= 4) return "••••";

  return `•••• ${trimmed.slice(-4)}`;
}
