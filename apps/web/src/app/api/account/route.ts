import { auth } from "@billow/auth";
import { getPrisma } from "@billow/db";
import { NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { error } from "@/lib/api/respond";
import { deleteUserDirectory } from "@/lib/storage";

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request))
    return error("Invalid request origin.", 403);
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

  // The database rows are gone first, files second. A crash or failure
  // between the two leaves orphaned bytes with no row pointing at them —
  // recoverable by a future sweep. Doing it in the other order risks the
  // reverse: files deleted while the account (and its Upload rows) still
  // exist, which is a data-loss bug the user never asked for and can't
  // detect. File cleanup is therefore best-effort and must never flip this
  // response to a failure — the account is deleted either way — but a
  // failure here is still recorded rather than swallowed, since it means
  // real bytes were left behind for an account that no longer exists.
  try {
    await deleteUserDirectory(userId);
  } catch (cleanupError) {
    console.error(
      `Failed to remove upload directory for deleted user ${userId}`,
      cleanupError,
    );
  }

  return NextResponse.json({ ok: true });
}
