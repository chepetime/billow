import "server-only";

import { getPrisma } from "@billow/db";
import type { Prisma } from "@billow/db/client";

// Persist errors to the database so they can be retrieved via /api/health
// after the fact, rather than relying on ephemeral container logs.
export async function recordError(
  context: string,
  error: unknown,
  meta?: Prisma.InputJsonValue,
) {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? null) : null;

    await getPrisma().errorLog.create({
      data: {
        context,
        message,
        stack,
        ...(meta === undefined ? {} : { meta }),
      },
    });
  } catch (persistError) {
    // Never let logging failures cascade (e.g. when the DB itself is the cause).
    console.error("[error-log] failed to persist error", persistError);
  }
}

export async function getRecentErrors(limit = 25) {
  try {
    return await getPrisma().errorLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  } catch (readError) {
    console.error("[error-log] failed to read errors", readError);
    return [];
  }
}
