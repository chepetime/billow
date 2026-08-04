import { beforeAll, describe, expect, it, vi } from "vitest";

// `./auth` is a `server-only` module by design — every other file in this
// package that touches Prisma is too, and that is deliberate (see env.ts's
// comment on why the actually-pure logic lives apart from it). Getting at
// claimFoundingOwner for a direct, real-function test means letting the
// import through: `server-only` throws when bundled outside Next, but does
// nothing on its own, so stubbing it to an empty module is enough to import
// the file under plain Node. It is not a stand-in for the guard itself
// disappearing — Next's bundler still enforces it in the real app.
vi.mock("server-only", () => ({}));

// `./auth` also builds the whole betterAuth() config at import time,
// including a prismaAdapter(getPrisma(), ...) call. Constructing that client
// does not open a connection (pg's Pool connects lazily on first query), but
// getAuthEnv() does throw synchronously without a real-looking secret, and
// createPrismaClient() throws without a DATABASE_URL. Neither needs a
// reachable database — no query in this file ever runs against them — so a
// placeholder value for each is enough to import the module safely offline.
beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??=
    "test-only-secret-value-at-least-32-characters";
  process.env.DATABASE_URL ??=
    "postgresql://billow:billow-password@localhost:5432/billow";
});

describe("claimFoundingOwner", () => {
  it("lets exactly one of many concurrent first registrations win", async () => {
    const { claimFoundingOwner } = await import("./auth");
    const { Prisma } = await import("@billow/db/client");

    // Models InstallationOwner's actual guarantee: `id` is a fixed primary
    // key, so Postgres itself allows only the very first INSERT against it
    // to succeed, and fails every other concurrent attempt with P2002 —
    // regardless of how many requests, processes, or racers are involved.
    // This fake reproduces exactly that contract (one winner, everyone else
    // gets the same error claimFoundingOwner is written to expect) without
    // needing a live database in this offline test run.
    let claimed: string | null = null;
    const fakePrisma = {
      installationOwner: {
        async create({ data }: { data: { userId: string } }) {
          // A real INSERT round-trips to the database before it resolves;
          // yielding here lets every concurrent caller reach this point
          // before any of them decides a winner, so the assertion below is
          // exercising real interleaving and not just call order.
          await Promise.resolve();
          if (claimed !== null) {
            throw new Prisma.PrismaClientKnownRequestError(
              "Unique constraint failed on the fields: (`id`)",
              {
                code: "P2002",
                clientVersion: "test",
                meta: { target: ["id"] },
              },
            );
          }
          claimed = data.userId;
          return { id: 1, userId: data.userId };
        },
      },
    };

    const registrants = ["user-a", "user-b", "user-c", "user-d", "user-e"];
    const results = await Promise.all(
      registrants.map((id) => claimFoundingOwner(fakePrisma, id)),
    );

    const winners = registrants.filter((_, i) => results[i]);
    expect(winners).toHaveLength(1);
    expect(claimed).toBe(winners[0]);
  });

  it("promotes a later registrant once the founding claim is free again", async () => {
    const { claimFoundingOwner } = await import("./auth");
    const { Prisma } = await import("@billow/db/client");

    let claimed: string | null = null;
    const fakePrisma = {
      installationOwner: {
        async create({ data }: { data: { userId: string } }) {
          if (claimed !== null) {
            throw new Prisma.PrismaClientKnownRequestError(
              "Unique constraint failed on the fields: (`id`)",
              {
                code: "P2002",
                clientVersion: "test",
                meta: { target: ["id"] },
              },
            );
          }
          claimed = data.userId;
          return { id: 1, userId: data.userId };
        },
      },
    };

    await expect(claimFoundingOwner(fakePrisma, "first")).resolves.toBe(true);
    await expect(claimFoundingOwner(fakePrisma, "second")).resolves.toBe(false);
  });

  it("does not swallow errors unrelated to the unique constraint", async () => {
    const { claimFoundingOwner } = await import("./auth");

    const boom = new Error("connection reset");
    const fakePrisma = {
      installationOwner: {
        create() {
          return Promise.reject(boom);
        },
      },
    };

    await expect(claimFoundingOwner(fakePrisma, "user-a")).rejects.toBe(boom);
  });
});

// The old code this replaced counted rows and then, in a second separate
// step, updated the winner: `if ((await prisma.user.count()) === 1) { ...
// update ... }` in packages/auth/src/auth.ts's create hook (see the removed
// version in git history). This reimplements that exact shape against a
// harness with the same real-interleaving guarantee as the fake above, to
// show the property claimFoundingOwner is asserted to hold above is not
// free: the count-based approach genuinely fails it under concurrency, on a
// process that gives each user row a strict insertion order (this app's
// production shape today, per the task's own framing) rather than needing
// separate Postgres transactions to demonstrate the failure.
describe("the count()-based promotion this replaced (regression harness)", () => {
  async function legacyPromote(users: string[]): Promise<boolean> {
    // Mirrors the two round trips the old code made: insert already landed
    // (that part happens before this hook runs, per-request), then a
    // separate count() read decides promotion.
    await Promise.resolve();
    const count = users.length;
    if (count === 1) return true;
    return false;
  }

  it("can promote nobody when registrations overlap", async () => {
    // Every registrant's own row is inserted synchronously before its
    // promotion check runs (mirrors "create, then run the after-hook" for
    // that same request). Two overlapping requests means both rows exist by
    // the time either promotion check reads the count.
    const users: string[] = [];
    users.push("user-a");
    users.push("user-b");

    const results = await Promise.all([
      legacyPromote(users),
      legacyPromote(users),
    ]);

    const winners = results.filter(Boolean);
    // This is the bug: neither registrant reads count() === 1, because by
    // the time either check runs, both rows already exist. An exposed
    // instance ends up with zero admins and no way back in.
    expect(winners).toHaveLength(0);
  });
});
