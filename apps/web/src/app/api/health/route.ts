import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getAuthEnv } from "@/lib/auth-env";
import { getRecentErrors } from "@/lib/error-log";
import { getPrisma } from "@billow/db";

export const dynamic = "force-dynamic";

function describe(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

// Lightweight diagnostics so a deployment can be debugged from the browser
// (Next redacts server-error details in production, so surface them here).
export async function GET() {
  const report: Record<string, unknown> = { ok: true };

  try {
    const env = getAuthEnv(process.env);
    report.authBaseUrl = env.baseUrl;
    report.authSecretConfigured = env.secret.length >= 32;
  } catch (error) {
    report.ok = false;
    report.authEnvError = describe(error);
  }

  try {
    const userCount = await getPrisma().user.count();
    report.database = { ok: true, userCount };
  } catch (error) {
    report.ok = false;
    report.database = { ok: false, error: describe(error) };
  }

  try {
    const session = await auth.api.getSession({ headers: await headers() });
    report.session = { ok: true, signedIn: Boolean(session) };
  } catch (error) {
    report.ok = false;
    report.session = { ok: false, error: describe(error) };
  }

  // Persisted server errors (from the onRequestError instrumentation hook and
  // getSession), newest first — the primary debugging surface.
  report.recentErrors = await getRecentErrors(25);

  return NextResponse.json(report, { status: report.ok ? 200 : 500 });
}
