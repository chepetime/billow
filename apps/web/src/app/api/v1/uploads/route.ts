import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { error } from "@/lib/api/respond";
import { recordError } from "@/lib/error-log";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { createUpload, listUploads, UploadRejectedError } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * A request carrying its own API key isn't a browser form submission a
 * hostile page could forge using the victim's cookies, so the same-origin
 * check below only guards the cookie/session path.
 */
function isCredentialedByApiKey(request: Request): boolean {
  return Boolean(
    request.headers.get("x-api-key") || request.headers.get("authorization"),
  );
}

/**
 * POST /api/v1/uploads
 *
 * Multipart form upload under a "file" field. Authenticate with a personal
 * API key (x-api-key or Authorization: Bearer) or a signed-in browser
 * session — see requireApiIdentity.
 */
export async function POST(request: Request) {
  // Resolve credentials first. Rejecting an unauthenticated caller with 403
  // would tell them they are forbidden when what they actually need is to
  // authenticate, so the origin check comes second and only guards the
  // cookie/session path.
  const identity = await requireApiIdentity(request.headers);
  if (identity instanceof NextResponse) return identity;

  if (!isCredentialedByApiKey(request) && !isSameOriginRequest(request)) {
    return error("Invalid request origin.", 403);
  }

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
    return NextResponse.json(upload, { status: 201 });
  } catch (err) {
    if (err instanceof UploadRejectedError) {
      return error(err.message, err.status);
    }
    await recordError("uploads.create", err);
    return error("Could not save the file.", 500);
  }
}

/**
 * GET /api/v1/uploads
 *
 * Lists the authenticated account's files together with current storage
 * usage against the per-account quota.
 */
export async function GET() {
  const identity = await requireApiIdentity(await headers());
  if (identity instanceof NextResponse) return identity;

  const { uploads, usageBytes, limitBytes } = await listUploads(
    identity.userId,
  );
  return NextResponse.json({
    uploads,
    usage: { bytes: usageBytes, limitBytes },
  });
}
