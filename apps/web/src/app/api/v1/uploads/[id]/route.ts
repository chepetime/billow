import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { error } from "@/lib/api/respond";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { recordError } from "@/lib/error-log";
import { contentDispositionHeader, deleteUpload, getUploadForUser, readUploadBytes } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** See the matching helper in ../route.ts: API-key callers skip the same-origin check. */
function isCredentialedByApiKey(request: Request): boolean {
  return Boolean(request.headers.get("x-api-key") || request.headers.get("authorization"));
}

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/uploads/[id]
 *
 * Serves the stored bytes for the authenticated account's own upload.
 * Looked up scoped by userId: another account's upload id 404s exactly like
 * a missing one, so this never confirms whether some other id exists.
 * Served with the sniffed content type (never a public static directory),
 * nosniff, and no-store, since this may include private documents.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const identity = await requireApiIdentity(await headers());
  if (identity instanceof NextResponse) return identity;

  const { id } = await params;
  const upload = await getUploadForUser(identity.userId, id);
  if (!upload) return error("Not found.", 404);

  let bytes: Buffer;
  try {
    bytes = await readUploadBytes(upload);
  } catch (err) {
    // The row exists but the object is missing or unreadable. Log the real
    // cause but still answer 404: from the caller's point of view the file
    // isn't there, and a 500 would suggest retrying will help.
    await recordError("uploads.download", err, { uploadId: upload.id });
    return error("Not found.", 404);
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": upload.contentType,
      "Content-Disposition": contentDispositionHeader(upload.filename),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * DELETE /api/v1/uploads/[id]
 *
 * Scoped by userId, same as GET: a missing or foreign id 404s. Removes the
 * object then the row (see lib/uploads.ts deleteUpload for the ordering
 * rationale) — a missing object never blocks removing the row.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  // Resolve credentials first. Rejecting an unauthenticated caller with 403
  // would tell them they are forbidden when what they actually need is to
  // authenticate, so the origin check comes second and only guards the
  // cookie/session path.
  const identity = await requireApiIdentity(request.headers);
  if (identity instanceof NextResponse) return identity;

  if (!isCredentialedByApiKey(request) && !isSameOriginRequest(request)) {
    return error("Invalid request origin.", 403);
  }

  const { id } = await params;
  const deleted = await deleteUpload(identity.userId, id);
  if (!deleted) return error("Not found.", 404);

  return NextResponse.json({ ok: true });
}
