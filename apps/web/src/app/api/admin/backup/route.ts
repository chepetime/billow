import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { getAdminSession, holdsRecoveryKey } from "@billow/auth";
import {
  type BackupEnvelope,
  sealBackupEntry,
  sealBackupWithRecoveryKey,
} from "@billow/crypto";
import { NextResponse } from "next/server";
import { error } from "@/lib/api/respond";
import { exportUploadRecords, exportWorkspace } from "@/lib/backup";
import { type TarEntrySource, writeTar } from "@/lib/backup-archive";
import {
  ENVELOPE_ENTRY,
  MANIFEST_ENTRY,
  RECOVERY_KEY_HEADER,
  uploadEntryName,
} from "@/lib/backup-format";
import { recordError } from "@/lib/error-log";
import { readObject } from "@/lib/storage";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/backup
 *
 * Exports the signed-in administrator's own domain data *and* their uploaded
 * files as a gzipped tar: `backup.json` holds the manifest, `files/NNNN` hold
 * the bytes. See lib/backup.ts for exactly what is and is not included.
 *
 * Streamed rather than assembled. Uploads are capped at 100 MB per account
 * while the container's heap is capped at 128 MB, so building the archive in
 * memory would fail on precisely the accounts most worth backing up. Each file
 * is read and emitted one at a time.
 *
 * **The default export is plaintext, deliberately.** It is built with the
 * encrypted-aware client, so account numbers, IBANs and tax IDs are decrypted
 * on the way out — a backup that only the installation it came from can read
 * is not a backup. That is a documented decision, not an oversight ("Backups
 * leave the encryption boundary" in the data-classification docs), and the
 * file must be treated as sensitive wherever it is stored.
 *
 * Send the account's recovery key in `x-billow-recovery-key` to get the sealed
 * form instead: same archive, every entry encrypted under a content key
 * wrapped by that recovery key. The key is *verified against the account*
 * first — a mistyped key would otherwise produce a file that looks like a
 * backup and can never be opened, which is the worst possible failure for this
 * feature. Restore performs no such check, because the whole point is
 * restoring somewhere the account does not exist yet.
 */
export async function GET(request: Request) {
  const { session, admin } = await getAdminSession();
  if (!session) return error("Authentication required.", 401);
  if (!admin) return error("Administrator access required.", 403);

  const userId = session.user.id;
  const recoveryKey = request.headers.get(RECOVERY_KEY_HEADER)?.trim() ?? "";

  let sealed: { envelope: BackupEnvelope; contentKey: Buffer } | null = null;
  if (recoveryKey) {
    if (!(await holdsRecoveryKey(userId, recoveryKey))) {
      return error(
        "That is not this account's current recovery key. An encrypted backup sealed with the wrong key could never be restored, so nothing was exported.",
        400,
      );
    }
    sealed = await sealBackupWithRecoveryKey(recoveryKey);
  }

  /** Encrypts one entry when the export is sealed, passes it through when not. */
  function entryBody(name: string, bytes: Buffer): Buffer {
    return sealed ? sealBackupEntry(sealed.contentKey, name, bytes) : bytes;
  }

  try {
    const { prisma } = await getWorkspacePrisma();
    const payload = await exportWorkspace(userId, prisma);
    const records = await exportUploadRecords(userId);
    const manifest = entryBody(
      MANIFEST_ENTRY,
      Buffer.from(JSON.stringify(payload, null, 2), "utf8"),
    );

    async function* entries(): AsyncGenerator<TarEntrySource> {
      // First, so a reader learns the archive is encrypted before it meets an
      // entry it cannot parse.
      if (sealed) {
        const header = Buffer.from(JSON.stringify(sealed.envelope), "utf8");
        yield {
          name: ENVELOPE_ENTRY,
          size: header.byteLength,
          body: () => [header],
        };
      }

      yield {
        name: MANIFEST_ENTRY,
        size: manifest.byteLength,
        body: () => [manifest],
      };

      for (const [index, record] of records.entries()) {
        // Read inside the generator so only the file being written is held.
        // A file that has vanished from disk is skipped rather than aborting
        // the export: a backup missing one attachment is worth far more than
        // no backup at all, and the manifest still records that it existed —
        // which is what makes the gap visible on restore.
        let bytes: Buffer;
        try {
          bytes = await readObject(record.storageKey);
        } catch (readError) {
          // `index` (not `record.storageKey`): the manifest and archive share
          // ordering, so this is enough to identify which entry failed
          // without putting a storage path in a table any admin can read.
          await recordError("admin.backup.export.missingFile", readError, {
            index,
          });
          continue;
        }

        // Sealing copies the file, so peak memory is two copies of one upload
        // (10 MB cap) rather than of the archive — the reason entries are
        // encrypted individually instead of as one stream.
        const name = uploadEntryName(index);
        const body = entryBody(name, bytes);

        yield { name, size: body.byteLength, body: () => [body] };
      }
    }

    const gzip = createGzip();
    Readable.from(writeTar(entries())).pipe(gzip);

    const date = new Date().toISOString().slice(0, 10);
    const filename = sealed
      ? `billow-backup-${date}-encrypted.tar.gz`
      : `billow-backup-${date}.tar.gz`;

    return new NextResponse(Readable.toWeb(gzip) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (exportError) {
    await recordError("admin.backup.export", exportError);
    return error("Could not build the backup file.", 500);
  }
}
