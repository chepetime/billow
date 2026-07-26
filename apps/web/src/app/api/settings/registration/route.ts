import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { error } from "@/lib/api/respond";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { getPrisma } from "@billow/db";

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) return error("Invalid request origin.", 403);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return error("Authentication required.", 401);

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
