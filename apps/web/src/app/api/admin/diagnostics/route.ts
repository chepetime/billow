import { timingSafeEqual } from "node:crypto";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { getAdminSession } from "@billow/auth";
import { collectDiagnostics } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

const MIN_TOKEN_LENGTH = 16;

/**
 * Break-glass access. Validating a session requires the database, so when the
 * database is the broken thing a session can never be produced and the
 * diagnostics would be unreachable exactly when they are needed.
 *
 * Setting BILLOW_DEBUG_TOKEN (>= 16 chars) lets `x-debug-token` stand in for a
 * session. Unset by default, so this stays closed unless deliberately enabled.
 */
function hasValidDebugToken(provided: string | null): boolean {
  const expected = process.env.BILLOW_DEBUG_TOKEN;
  if (!expected || expected.length < MIN_TOKEN_LENGTH || !provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET /api/admin/diagnostics
 *
 * Machine-readable twin of /admin/debug. The payload includes environment
 * keys, request headers, database internals, and stack traces, so it is never
 * public. The unauthenticated probe is /api/health.
 */
export async function GET() {
  const requestHeaders = await headers();

  if (!hasValidDebugToken(requestHeaders.get("x-debug-token"))) {
    // Admin, not merely signed in. This payload carries environment variable
    // names and lengths, request headers, database internals and the
    // installation-wide error log — whose stacks and metadata belong to every
    // account, not the one asking. Any-session was the wrong bar for a route
    // named /api/admin.
    let session = null;
    let admin = false;
    try {
      ({ session, admin } = await getAdminSession());
    } catch {
      session = null;
      admin = false;
    }

    // 401 and 403 are different answers and the caller can act on which one
    // they get: no credentials means sign in, wrong credentials means this
    // account will never be enough. Collapsing both into 403 told an anonymous
    // caller their (absent) credentials had been rejected.
    if (!session) {
      return NextResponse.json(
        {
          error:
            "Authentication required. Sign in as an administrator, or send x-debug-token if BILLOW_DEBUG_TOKEN is configured.",
        },
        { status: 401 },
      );
    }

    if (!admin) {
      return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
    }
  }

  return NextResponse.json(await collectDiagnostics(requestHeaders));
}
