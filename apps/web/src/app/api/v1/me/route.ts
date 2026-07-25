import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getPrisma } from "@billow/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/me
 *
 * Returns the account behind the caller's credentials. Authenticate with a
 * personal API key (created in Settings) sent as either:
 *   x-api-key: <key>
 *   Authorization: Bearer <key>
 * A signed-in browser session also works, which makes the route easy to try.
 */
export async function GET() {
  const requestHeaders = await headers();

  const bearer = requestHeaders.get("authorization");
  const apiKey =
    requestHeaders.get("x-api-key") ??
    (bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : null);

  let userId: string | null = null;

  if (apiKey) {
    const result = await auth.api.verifyApiKey({ body: { key: apiKey } });

    if (!result.valid || !result.key) {
      return NextResponse.json(
        { error: result.error?.message ?? "Invalid API key." },
        { status: 401 },
      );
    }

    userId = result.key.referenceId;
  } else {
    const session = await auth.api.getSession({ headers: requestHeaders });
    userId = session?.user.id ?? null;
  }

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required. Send an API key via x-api-key." },
      { status: 401 },
    );
  }

  const user = await getPrisma().user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, username: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  return NextResponse.json(user);
}
