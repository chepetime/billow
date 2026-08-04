import { getPrisma } from "@billow/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { requireApiIdentity } from "@/lib/api/identity";
import { error } from "@/lib/api/respond";

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
  const identity = await requireApiIdentity(await headers());
  if (identity instanceof NextResponse) return identity;

  const user = await getPrisma().user.findUnique({
    where: { id: identity.userId },
    select: { id: true, email: true, name: true, username: true },
  });

  if (!user) return error("Account not found.", 404);

  return NextResponse.json(user);
}
