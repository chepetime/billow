import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { error } from "@/lib/api/respond";
import { recordError } from "@/lib/error-log";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import {
  createUpload,
  isUploadKindFilter,
  listUploads,
  toUploadResponse,
  UPLOAD_KINDS,
  UploadRejectedError,
} from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/uploads
 *
 * Multipart form upload under a "file" field. Authenticate with a personal
 * API key (x-api-key or Authorization: Bearer) or a signed-in browser
 * session — see requireApiIdentity.
 */
export async function POST(request: Request) {
  const identity = await requireApiIdentity(request, { mutating: true });
  if (identity instanceof NextResponse) return identity;

  // Cheap pre-check before parsing the multipart body at all: when the
  // client declares Content-Length far beyond the limit, reject without
  // buffering the payload. This is not the authoritative check — Content-
  // Length can be absent or wrong for a chunked body — so the real file
  // bytes are checked again inside createUpload once parsed.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_UPLOAD_BYTES + 65_536
  ) {
    return error("File is too large.", 413);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return error(
      'Send the file as multipart form data under the "file" field.',
      400,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const upload = await createUpload(identity.userId, {
      name: file.name,
      bytes,
    });
    return NextResponse.json(toUploadResponse(upload), { status: 201 });
  } catch (err) {
    if (err instanceof UploadRejectedError) {
      return error(err.message, err.status);
    }
    await recordError("uploads.create", err);
    return error("Could not save the file.", 500);
  }
}

/**
 * GET /api/v1/uploads[?kind=...]
 *
 * Lists the authenticated account's files together with current storage
 * usage against the per-account quota.
 *
 * `kind` defaults to "attachment" — the files the owner manages directly — so
 * the default response is unchanged. "all", or a specific workflow kind, also
 * returns the documents the invoice workflow has adopted. Those have always counted
 * against the quota; before this parameter existed there was no way to see
 * them, which made `usage.bytes` look inflated by files that did not exist.
 */
export async function GET(request: Request) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const requestedKind = new URL(request.url).searchParams.get("kind");
  if (requestedKind !== null && !isUploadKindFilter(requestedKind)) {
    return error(
      `Unknown kind. Use one of: ${UPLOAD_KINDS.join(", ")}, all.`,
      400,
    );
  }

  const { uploads, usageBytes, usageByKind, limitBytes } = await listUploads(
    identity.userId,
    { kind: requestedKind ?? undefined },
  );
  return NextResponse.json({
    uploads: uploads.map(toUploadResponse),
    usage: { bytes: usageBytes, byKind: usageByKind, limitBytes },
  });
}
