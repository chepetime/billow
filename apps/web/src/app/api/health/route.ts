import { NextResponse } from "next/server";

import { getPrisma } from "@billow/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Public liveness/readiness probe. Deliberately returns a boolean status and
 * nothing else: no versions, counts, environment, or error details. Detailed
 * diagnostics live behind a session at /admin/debug and
 * /api/admin/diagnostics.
 */
export async function GET() {
  let ready = true;

  try {
    await getPrisma().$queryRaw`SELECT 1`;
  } catch {
    ready = false;
  }

  return NextResponse.json(
    { status: ready ? "ok" : "unavailable" },
    { status: ready ? 200 : 503 },
  );
}
