import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const require_ = createRequire(import.meta.url);

// React ships two builds. The `react-server` condition — the one an RSC bundle
// resolves — is the only one where `cache` actually memoizes; the default
// build exports it as a bare pass-through. Vitest resolves the default build,
// so importing `react` normally here would test nothing at all. Load the
// server build by file path (package `exports` hides the subpath) so these
// assertions run against the implementation production uses.
const reactServer = require_(
  path.join(
    path.dirname(require_.resolve("react/package.json")),
    "cjs/react.react-server.development.js",
  ),
);

vi.mock("server-only", () => ({}));
vi.mock("react", () => reactServer);

const getSessionSpy = vi.fn();

vi.mock("./auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSessionSpy(...args) } },
}));

const headersSpy = vi.fn();

vi.mock("next/headers", () => ({ headers: () => headersSpy() }));

const redirectSpy = vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
});

vi.mock("next/navigation", () => ({ redirect: () => redirectSpy() }));

const { getSession, requireSession } = await import("./session");

// A faithful stand-in for React's Flight dispatcher: the real one is a single
// stateless object whose cache is looked up through AsyncLocalStorage on the
// in-flight request, which is precisely what keeps two renders apart. Model it
// the same way so "separate requests" here means what it means in production.
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

function sessionFor(userId: string) {
  return { session: { id: `sess-${userId}` }, user: { id: userId } };
}

beforeEach(() => {
  getSessionSpy.mockReset();
  headersSpy.mockReset();
  headersSpy.mockResolvedValue(new Headers());
});

describe("getSession", () => {
  it("resolves the session once for repeated calls in one request", async () => {
    getSessionSpy.mockResolvedValue(sessionFor("alice"));

    const results = await inRequest(async () => [
      await getSession(),
      await getSession(),
      await requireSession(),
      await getSession(),
    ]);

    expect(getSessionSpy).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toEqual(sessionFor("alice"));
    }
  });

  it("does not carry a session from one request into the next", async () => {
    getSessionSpy.mockResolvedValueOnce(sessionFor("alice"));
    getSessionSpy.mockResolvedValueOnce(sessionFor("bob"));

    const first = await inRequest(() => getSession());
    const second = await inRequest(() => getSession());

    expect(getSessionSpy).toHaveBeenCalledTimes(2);
    expect(first).toEqual(sessionFor("alice"));
    expect(second).toEqual(sessionFor("bob"));
  });

  it("keeps concurrent requests from seeing each other's session", async () => {
    // The failure this guards against is two users' renders interleaving, so
    // resolve them out of order rather than one after the other.
    const pending = new Map<string, (value: unknown) => void>();
    getSessionSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.set(`user-${pending.size}`, resolve);
        }),
    );

    const alice = inRequest(async () => [
      await getSession(),
      await getSession(),
    ]);
    const bob = inRequest(async () => [await getSession(), await getSession()]);
    await vi.waitFor(() => expect(pending.size).toBe(2));

    pending.get("user-1")?.(sessionFor("bob"));
    pending.get("user-0")?.(sessionFor("alice"));

    expect(await alice).toEqual([sessionFor("alice"), sessionFor("alice")]);
    expect(await bob).toEqual([sessionFor("bob"), sessionFor("bob")]);
    expect(getSessionSpy).toHaveBeenCalledTimes(2);
  });

  it("calls straight through outside a render, as route handlers do", async () => {
    getSessionSpy.mockResolvedValue(sessionFor("alice"));

    await getSession();
    await getSession();

    // React installs its dispatcher once and never clears it, so a route
    // handler still has one; what it lacks is an in-flight request to hang the
    // memo on, leaving nothing retained for a later request to reach.
    expect(getSessionSpy).toHaveBeenCalledTimes(2);
  });

  it("reports a failure as signed out rather than throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getSessionSpy.mockRejectedValue(new Error("postgres is down"));

    await expect(inRequest(() => getSession())).resolves.toBeNull();
  });
});
