import { NextResponse } from "next/server";

import { getAdminSession } from "@/lib/admin";
import { error } from "@/lib/api/respond";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { getPrisma } from "@billow/db";

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) return error("Invalid request origin.", 403);
  // Registration policy is installation-wide, so it is an administrator
  // action rather than something any signed-in account may change.
  const { session, admin } = await getAdminSession();
  if (!session) return error("Authentication required.", 401);
  if (!admin) return error("Administrator access required.", 403);

  const body = (await request.json().catch(() => null)) as {
    enabled?: unknown;
  } | null;
  if (typeof body?.enabled !== "boolean") {
    return error("enabled must be a boolean.", 400);
  }

  const settings = await getPrisma().registrationSettings.upsert({
    where: { id: 1 },
    create: { id: 1, enabled: body.enabled },
    update: { enabled: body.enabled },
  });

  return NextResponse.json({ enabled: settings.enabled });
}
