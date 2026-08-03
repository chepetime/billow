import "server-only";

import { getPrisma } from "@billow/db";

/**
 * A fixed-window limiter for this app's own routes.
 *
 * BetterAuth's limiter only sees `/api/auth/*`, which leaves the routes that
 * actually run scrypt — the vault, and recovery-key issue/confirm/restore —
 * completely unthrottled. That matters more here than the usual brute-force
 * argument: scrypt is configured at N=32768 with a 64 MB memory bound, against
 * a container whose old-space cap is 128 MB. Two concurrent calls exhaust the
 * heap. The limit is as much about keeping the process alive as about slowing
 * a guesser down.
 *
 * Shares the `RateLimit` table with BetterAuth rather than keeping counters in
 * memory, so a redeploy does not reset every bucket — this app restarts on
 * every update.
 */
export type RateLimitResult = { allowed: boolean; retryAfter: number };

export async function consumeRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const prisma = getPrisma();
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  try {
    const existing = await prisma.rateLimit.findUnique({ where: { key } });

    if (!existing) {
      await prisma.rateLimit.create({ data: { key, count: 1, lastRequest: BigInt(now) } });
      return { allowed: true, retryAfter: 0 };
    }

    const lastRequest = Number(existing.lastRequest);

    // Window elapsed: start a new one.
    if (now - lastRequest > windowMs) {
      await prisma.rateLimit.update({
        where: { key },
        data: { count: 1, lastRequest: BigInt(now) },
      });
      return { allowed: true, retryAfter: 0 };
    }

    if (existing.count >= max) {
      return { allowed: false, retryAfter: Math.ceil((lastRequest + windowMs - now) / 1000) };
    }

    await prisma.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 }, lastRequest: BigInt(now) },
    });
    return { allowed: true, retryAfter: 0 };
  } catch {
    // A limiter that fails closed would take the feature down with the
    // database; one that fails open leaves the route as unprotected as it was
    // before this existed. Open is the lesser harm, and the request still has
    // to be authenticated to get here.
    return { allowed: true, retryAfter: 0 };
  }
}
