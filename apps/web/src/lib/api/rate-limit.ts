import "server-only";

import { randomUUID } from "node:crypto";

import { getPrisma } from "@billow/db";

/**
 * A fixed-window limiter for this app's own routes.
 *
 * BetterAuth's limiter only sees `/api/auth/*`, which leaves the routes that
 * actually run scrypt — the vault, and recovery-key issue/confirm/restore —
 * completely unthrottled. That matters more here than the usual brute-force
 * argument: scrypt is configured at N=32768 with a 64 MB memory bound, and
 * OpenSSL allocates that buffer natively, outside V8's heap. So
 * `--max-old-space-size=128` does NOT bound it — the only ceiling is the
 * container's memory limit, which those derivations share with the Node heap,
 * the Postgres pool and everything else in the process. A handful of
 * concurrent calls is enough to get the container OOM-killed, and it dies
 * without a V8 heap error to explain why. The limit is as much about keeping
 * the process alive as about slowing a guesser down.
 *
 * Shares the `RateLimit` table with BetterAuth rather than keeping counters in
 * memory, so a redeploy does not reset every bucket — this app restarts on
 * every update.
 */
export type RateLimitResult = { allowed: boolean; retryAfter: number };

/**
 * One statement, so the read and the write cannot be pulled apart.
 *
 * The obvious `findUnique` -> decide -> `update` shape only holds under
 * sequential load: concurrent callers all read the same under-limit count and
 * all proceed, which is exactly the burst the limiter exists to stop. `ON
 * CONFLICT` makes the whole decision one atomic row operation — the second
 * writer blocks on the first's row lock and then re-evaluates against the
 * committed count.
 *
 * `$queryRawUnsafe` rather than a tagged template because the window test
 * reuses `$3` four times and `$4` twice; a tagged template emits a fresh
 * placeholder per interpolation, so the same two values would be bound six
 * times over. Nothing is interpolated into the SQL — it is a constant, and
 * every value below is a bound parameter.
 *
 * `lastRequest` deliberately does not move while a window is open. It anchors
 * the window at its first request, so `retryAfter` counts down to a fixed
 * instant and a caller that keeps hammering after being rejected cannot push
 * their own reset further out.
 *
 * The bigints travel as text with explicit casts: the driver's parameter
 * inference has no column to work from in the `CASE` arms.
 */
const CONSUME_SQL = `
INSERT INTO "rateLimit" ("id", "key", "count", "lastRequest")
VALUES ($1, $2, 1, $3::bigint)
ON CONFLICT ("key") DO UPDATE
  SET "count" = CASE
        WHEN $3::bigint - "rateLimit"."lastRequest" > $4::bigint THEN 1
        ELSE "rateLimit"."count" + 1
      END,
      "lastRequest" = CASE
        WHEN $3::bigint - "rateLimit"."lastRequest" > $4::bigint THEN $3::bigint
        ELSE "rateLimit"."lastRequest"
      END
RETURNING "count", "lastRequest"
`;

type ConsumeRow = { count: number; lastRequest: bigint };

export async function consumeRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const prisma = getPrisma();
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  try {
    const rows = await prisma.$queryRawUnsafe<ConsumeRow[]>(
      CONSUME_SQL,
      // The model's `id` default is `cuid()`, which Prisma applies in the
      // client; raw SQL bypasses that and the column has no database default.
      randomUUID(),
      key,
      String(now),
      String(windowMs),
    );

    const row = rows[0];
    if (!row) {
      return { allowed: true, retryAfter: 0 };
    }

    // The count is post-increment, so `max` requests land on `count === max`
    // and the first one over the line is `max + 1`. Rejected requests keep
    // incrementing — nothing reads the count except this comparison.
    if (row.count <= max) {
      return { allowed: true, retryAfter: 0 };
    }

    // Floor of one second: callers put this straight into "try again in N
    // seconds", and a rejection that says to retry in zero is a bug report.
    const windowStart = Number(row.lastRequest);
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
    };
  } catch {
    // A limiter that fails closed would take the feature down with the
    // database; one that fails open leaves the route as unprotected as it was
    // before this existed. Open is the lesser harm, and the request still has
    // to be authenticated to get here.
    return { allowed: true, retryAfter: 0 };
  }
}
