/**
 * The names and headers that make up a backup archive's wire format.
 *
 * Split out of lib/backup.ts because the settings UI needs them too, and that
 * module imports the Prisma client — a `const` shared through it would drag the
 * database layer into the browser bundle. Everything here is a plain string,
 * with no runtime dependency at all.
 */

/** Archive entry name for the Nth exported upload. Generated, never user text. */
export function uploadEntryName(index: number): string {
  return `files/${String(index).padStart(4, "0")}`;
}

/** The manifest entry. Encrypted like any other entry in a sealed archive. */
export const MANIFEST_ENTRY = "backup.json";

/**
 * The one entry an encrypted archive leaves readable, holding the salt and the
 * wrapped content key. Its presence is what tells a restore that the rest of
 * the archive is ciphertext and a recovery key is needed: both kinds of backup
 * are a gzipped tar with the same extension, so the format has to be decidable
 * from the bytes rather than from what the browser calls the file.
 */
export const ENVELOPE_ENTRY = "backup-envelope.json";

/**
 * Carries the recovery key on export and restore.
 *
 * A header rather than a query string or a JSON body: the export is a GET
 * whose response is a download, a query string lands in proxy access logs and
 * browser history, and the restore body is already the raw archive. This is
 * the same shape the vault lab uses (`x-billow-vault-key`), and it inherits the
 * same caveat — on a plain-HTTP install the key crosses the network in the
 * clear, which is why the UI says so where it is typed.
 */
export const RECOVERY_KEY_HEADER = "x-billow-recovery-key";
