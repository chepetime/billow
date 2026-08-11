import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const require_ = createRequire(import.meta.url);

// React ships two builds, and only the `react-server` one memoizes `cache`;
// the default build Vitest resolves exports it as a bare pass-through, which
// would make every assertion below pass for the wrong reason. Load the server
// build by file path, exactly as session.test.ts does — the note there
// explains the mechanism in full.
const reactServer = require_(
  path.join(
    path.dirname(require_.resolve("react/package.json")),
    "cjs/react.react-server.development.js",
  ),
);

vi.mock("server-only", () => ({}));
vi.mock("react", () => reactServer);

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet }),
}));

const findSession = vi.fn();
const prisma = {
  session: { findUnique: findSession },
  userKeyset: { findUnique: vi.fn() },
  userOnboarding: { findUnique: vi.fn() },
  verification: { findFirst: vi.fn() },
};

vi.mock("@billow/db", () => ({ getPrisma: () => prisma }));
vi.mock("@billow/db/field-encryption", () => ({
  backfillEncryptedFields: vi.fn(),
}));

const resumeSession = vi.fn();
vi.mock("@billow/crypto", () => ({
  beginSession: vi.fn(),
  changePassword: vi.fn(),
  createUserKeyset: vi.fn(),
  issueRecoveryKey: vi.fn(),
  KeyHierarchyError: class KeyHierarchyError extends Error {},
  resetPasswordWithRecoveryKey: vi.fn(),
  resumeSession: (...args: unknown[]) => resumeSession(...args),
  unlockWithPassword: vi.fn(),
  unlockWithRecoveryKey: vi.fn(),
}));

const { getDataKey, getRecoveryKeyState } = await import("./data-key");

// The same stand-in for React's Flight dispatcher that session.test.ts builds:
// a per-request store reached through AsyncLocalStorage, so "separate
// requests" here means what it means in production.
const requestStorage = new AsyncLocalStorage<Map<unknown, unknown>>();

reactServer.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A =
  {
    getCacheForType(resourceType: () => unknown) {
      const store = requestStorage.getStore() ?? new Map();
      let entry = store.get(resourceType);
      if (entry === undefined) {
        entry = resourceType();
        store.set(resourceType, entry);
      }
      return entry;
    },
    cacheSignal: () => null,
  };

/** Runs `fn` in its own request scope, as one RSC render would. */
function inRequest<T>(fn: () => Promise<T>) {
  return requestStorage.run(new Map(), fn);
}

beforeEach(() => {
  findSession.mockReset();
  findSession.mockResolvedValue({ dataKeyWrappedBySessionKey: "wrapped" });
  resumeSession.mockReset();
  resumeSession.mockImplementation(async () => Buffer.from("data-key"));
  cookieGet.mockReset();
  cookieGet.mockReturnValue({ value: "session-key" });
  prisma.userKeyset.findUnique.mockResolvedValue({ recoverySalt: "salt" });
  prisma.userOnboarding.findUnique.mockResolvedValue(null);
  prisma.verification.findFirst.mockResolvedValue(null);
});

describe("getDataKey", () => {
  it("reads the session row once for repeated calls in one request", async () => {
    const keys = await inRequest(async () => [
      await getDataKey("alice", "sess-alice"),
      await getDataKey("alice", "sess-alice"),
      await getDataKey("alice", "sess-alice"),
    ]);

    expect(findSession).toHaveBeenCalledTimes(1);
    for (const key of keys) {
      expect(key).toEqual(Buffer.from("data-key"));
    }
  });

  it("reads the session row once across a whole dashboard render", async () => {
    // The shape the app layout and the page produce between them: the layout's
    // onboarding gate calls getRecoveryKeyState (which calls getDataKey), and
    // the workspace client calls getDataKey again.
    const [state, dataKey] = await inRequest(async () => [
      await getRecoveryKeyState("alice", "sess-alice"),
      await getDataKey("alice", "sess-alice"),
    ]);

    expect(findSession).toHaveBeenCalledTimes(1);
    expect(state.dataKeyAvailable).toBe(true);
    expect(state.sessionHasDataKeyWrap).toBe(true);
    expect(dataKey).toEqual(Buffer.from("data-key"));
  });

  it("still reports a session that carries no wrap", async () => {
    findSession.mockResolvedValue({ dataKeyWrappedBySessionKey: null });

    const [state, dataKey] = await inRequest(async () => [
      await getRecoveryKeyState("alice", "sess-alice"),
      await getDataKey("alice", "sess-alice"),
    ]);

    expect(state.sessionHasDataKeyWrap).toBe(false);
    expect(state.dataKeyAvailable).toBe(false);
    expect(dataKey).toBeNull();
  });

  it("does not carry one request's session row into the next", async () => {
    findSession.mockResolvedValueOnce({ dataKeyWrappedBySessionKey: "first" });
    findSession.mockResolvedValueOnce({ dataKeyWrappedBySessionKey: "second" });

    await inRequest(() => getDataKey("alice", "sess-alice"));
    await inRequest(() => getDataKey("alice", "sess-alice"));

    expect(findSession).toHaveBeenCalledTimes(2);
    expect(resumeSession).toHaveBeenNthCalledWith(
      1,
      "alice",
      "first",
      "session-key",
    );
    expect(resumeSession).toHaveBeenNthCalledWith(
      2,
      "alice",
      "second",
      "session-key",
    );
  });

  it("keeps two sessions in one request from sharing a wrap", async () => {
    // Distinct sessionIds are distinct cache entries; the memo is keyed on the
    // argument, so a second session in the same request must not read the
    // first one's row.
    findSession.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        dataKeyWrappedBySessionKey: `wrapped-${where.id}`,
      }),
    );

    await inRequest(async () => {
      await getDataKey("alice", "sess-alice");
      await getDataKey("bob", "sess-bob");
    });

    expect(findSession).toHaveBeenCalledTimes(2);
    expect(resumeSession).toHaveBeenNthCalledWith(
      1,
      "alice",
      "wrapped-sess-alice",
      "session-key",
    );
    expect(resumeSession).toHaveBeenNthCalledWith(
      2,
      "bob",
      "wrapped-sess-bob",
      "session-key",
    );
  });

  it("calls straight through outside a render, as route handlers do", async () => {
    // Route handlers are where the data-key cookie is written, so they must
    // never read a wrap this request has already replaced.
    await getDataKey("alice", "sess-alice");
    await getDataKey("alice", "sess-alice");

    expect(findSession).toHaveBeenCalledTimes(2);
  });

  it("never reads the session row without a cookie to open it with", async () => {
    cookieGet.mockReturnValue(undefined);

    expect(await inRequest(() => getDataKey("alice", "sess-alice"))).toBeNull();
    expect(findSession).not.toHaveBeenCalled();
  });
});
