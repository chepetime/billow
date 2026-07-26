import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { error } from "@/lib/api/respond";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { getPrisma } from "@billow/db";

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return error("Invalid request origin.", 403);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return error("Authentication required.", 401);

  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
    confirmation?: unknown;
  } | null;
  if (typeof body?.password !== "string" || body.confirmation !== "DELETE") {
    return error("Confirm account deletion and enter your password.", 400);
  }

  try {
    await auth.api.verifyPassword({
      headers: request.headers,
      body: { password: body.password },
    });
  } catch {
    return error("Your password is incorrect.", 400);
  }

  const userId = session.user.id;
  const prisma = getPrisma();
  await prisma.$transaction([
    prisma.apikey.deleteMany({ where: { referenceId: userId } }),
    prisma.invoice.deleteMany({ where: { userId } }),
    prisma.clientCompany.deleteMany({ where: { userId } }),
    prisma.userProfile.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  return NextResponse.json({ ok: true });
}
