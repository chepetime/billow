import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { getAdminSession } from "@billow/auth";
import { NextResponse } from "next/server";
import { error } from "@/lib/api/respond";
import {
  exportUploadRecords,
  exportWorkspace,
  uploadEntryName,
} from "@/lib/backup";
import { type TarEntrySource, writeTar } from "@/lib/backup-archive";
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
 */
export async function GET() {
  const { session, admin } = await getAdminSession();
  if (!session) return error("Authentication required.", 401);
  if (!admin) return error("Administrator access required.", 403);

  try {
    const userId = session.user.id;
    const { prisma } = await getWorkspacePrisma();
    const payload = await exportWorkspace(userId, prisma);
    const records = await exportUploadRecords(userId);
    const manifest = Buffer.from(JSON.stringify(payload, null, 2), "utf8");

    async function* entries(): AsyncGenerator<TarEntrySource> {
      yield {
        name: "backup.json",
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

        yield {
          name: uploadEntryName(index),
          size: bytes.byteLength,
          body: () => [bytes],
        };
      }
    }

    const gzip = createGzip();
    Readable.from(writeTar(entries())).pipe(gzip);

    const filename = `billow-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;

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
