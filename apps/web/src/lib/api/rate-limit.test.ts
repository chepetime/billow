import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaHolder } = vi.hoisted(() => ({
  prismaHolder: { current: null as unknown },
}));

vi.mock("@billow/db", () => ({
  getPrisma: () => prismaHolder.current,
}));

const { consumeRateLimit } = await import("@/lib/api/rate-limit");

type Row = { count: number; lastRequest: bigint };

/**
 * A stand-in for the `rateLimit` table that reproduces the one property the
 * limiter's correctness rests on: a statement is indivisible, but the gap
 * between two statements is not.
 *
 * Every operation yields to the event loop before it touches the map and then
 * runs to completion synchronously — which is exactly what Postgres gives a
 * single statement against a single row, and exactly what it does not give a
 * read followed by a separate write. Node's own concurrency does the rest:
 * callers started together all reach their first `await` before any of them
 * resumes, so a read-then-write limiter sees a stale count and an atomic one
 * cannot.
 *
 * `checkThenAct` below is not dead code — it is the control. It drives this
 * same fake through the shape the limiter used to have, and it is what proves
 * the fake actually detects the race rather than the test passing either way.
 */
class FakeRateLimitTable {
  rows = new Map<string, Row>();
  failing = false;

  private async statement<T>(apply: () => T): Promise<T> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (this.failing) throw new Error("connection terminated");
    return apply();
  }

  $queryRawUnsafe = <T>(sql: string, ...params: unknown[]): Promise<T> => {
    // The whole defence is that this is ONE statement. A limiter that split it
    // back into two would still pass every assertion below if the fake let it,
    // so refuse to model more than one.
    expect(sql.replace(/;\s*$/, "")).not.toContain(";");
    expect(sql).toContain("ON CONFLICT");

    const [, key, now, windowMs] = params as [string, string, string, string];
    const at = BigInt(now);
    const window = BigInt(windowMs);

    return this.statement(() => {
      const existing = this.rows.get(key);
      if (!existing) {
        const created = { count: 1, lastRequest: at };
        this.rows.set(key, created);
        return [{ ...created }] as T;
      }

      const rolled = at - existing.lastRequest > window;
      const next: Row = rolled
        ? { count: 1, lastRequest: at }
        : { count: existing.count + 1, lastRequest: existing.lastRequest };
      this.rows.set(key, next);
      return [{ ...next }] as T;
    });
  };

  findUnique = ({ where }: { where: { key: string } }) =>
    this.statement(() => {
      const row = this.rows.get(where.key);
      return row ? { ...row } : null;
    });

  create = ({ data }: { data: Row & { key: string } }) =>
    this.statement(() => {
      this.rows.set(data.key, {
        count: data.count,
        lastRequest: data.lastRequest,
      });
    });

  update = ({
    where,
    data,
  }: {
    where: { key: string };
    data: { count: number | { increment: number }; lastRequest: bigint };
  }) =>
    this.statement(() => {
      const existing = this.rows.get(where.key);
      // `{ increment: n }` is atomic in Prisma, and modelling it as such is
      // what keeps the control below failing for the right reason: the race is
      // the stale read that preceded the write, not the write itself.
      const count =
        typeof data.count === "number"
          ? data.count
          : (existing?.count ?? 0) + data.count.increment;
      this.rows.set(where.key, { count, lastRequest: data.lastRequest });
    });
}

function fakePrisma(table: FakeRateLimitTable) {
  return {
    $queryRawUnsafe: table.$queryRawUnsafe,
    rateLimit: {
      findUnique: table.findUnique,
      create: table.create,
      update: table.update,
    },
  };
}

/** The pre-fix implementation, kept only as the control for the race test. */
async function checkThenAct(
  table: FakeRateLimitTable,
  key: string,
  max: number,
  windowSeconds: number,
) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const existing = await table.findUnique({ where: { key } });

  if (!existing) {
    await table.create({ data: { key, count: 1, lastRequest: BigInt(now) } });
    return { allowed: true };
  }
  if (now - Number(existing.lastRequest) > windowMs) {
    await table.update({
      where: { key },
      data: { count: 1, lastRequest: BigInt(now) },
    });
    return { allowed: true };
  }
  if (existing.count >= max) return { allowed: false };
  await table.update({
    where: { key },
    data: { count: { increment: 1 }, lastRequest: BigInt(now) },
  });
  return { allowed: true };
}

let table: FakeRateLimitTable;

beforeEach(() => {
  table = new FakeRateLimitTable();
  prismaHolder.current = fakePrisma(table);
});

describe("consumeRateLimit under concurrency", () => {
  it("admits exactly `max` of a simultaneous burst", async () => {
    // The burst is the scenario the limiter exists for: several scrypt
    // derivations arriving at once, each holding 64 MB natively.
    const results = await Promise.all(
      Array.from({ length: 12 }, () => consumeRateLimit("vault:u1", 3, 60)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(table.rows.get("vault:u1")?.count).toBe(12);
  });

  it("admits the whole burst when the read and the write are separate", async () => {
    // The control. If this ever reports 3 the fake has stopped modelling the
    // race, and the assertion above proves nothing.
    const results = await Promise.all(
      Array.from({ length: 12 }, () => checkThenAct(table, "vault:u1", 3, 60)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(12);
  });

  it("keeps separate keys from consuming each other's budget", async () => {
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => consumeRateLimit("vault:a", 2, 60)),
      ...Array.from({ length: 5 }, () => consumeRateLimit("vault:b", 2, 60)),
    ]);

    expect(results.filter((r) => r.allowed)).toHaveLength(4);
  });
});

describe("consumeRateLimit sequentially", () => {
  it("allows up to max and then rejects", async () => {
    expect((await consumeRateLimit("k", 2, 60)).allowed).toBe(true);
    expect((await consumeRateLimit("k", 2, 60)).allowed).toBe(true);
    expect((await consumeRateLimit("k", 2, 60)).allowed).toBe(false);
  });

  it("reports a retryAfter of at least one second", async () => {
    await consumeRateLimit("k", 1, 60);
    const rejected = await consumeRateLimit("k", 1, 60);

    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfter).toBeGreaterThanOrEqual(1);
    expect(rejected.retryAfter).toBeLessThanOrEqual(60);
  });

  it("anchors the window at its first request rather than sliding it", async () => {
    // Real clock, not fake timers: the fake table awaits a real `setTimeout`
    // to model a statement's latency, and faking timers deadlocks it.
    await consumeRateLimit("k", 5, 60);
    const anchor = table.rows.get("k")?.lastRequest;

    // A later request inside the window must not push the reset out, or a
    // caller who keeps hammering could hold their own bucket open forever.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await consumeRateLimit("k", 5, 60);

    expect(table.rows.get("k")?.count).toBe(2);
    expect(table.rows.get("k")?.lastRequest).toBe(anchor);
  });

  it("starts a fresh window once the old one has elapsed", async () => {
    // 20 ms, so the window can actually elapse inside the test.
    expect((await consumeRateLimit("k", 1, 0.02)).allowed).toBe(true);
    expect((await consumeRateLimit("k", 1, 0.02)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect((await consumeRateLimit("k", 1, 0.02)).allowed).toBe(true);
    expect(table.rows.get("k")?.count).toBe(1);
  });
});

describe("consumeRateLimit when the database is unreachable", () => {
  it("fails open", async () => {
    table.failing = true;

    // Failing closed would take the vault down with Postgres; the route is
    // still behind authentication either way.
    expect(await consumeRateLimit("k", 1, 60)).toEqual({
      allowed: true,
      retryAfter: 0,
    });
  });
});
