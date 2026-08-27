import { beforeEach, describe, expect, it, vi } from "vitest";

const recordError = vi.fn();
const getWorkspacePrisma = vi.fn(async () => ({
  prisma: { marker: "client" },
  encrypted: false as const,
}));

vi.mock("@/lib/error-log", () => ({
  recordError: (...args: unknown[]) => recordError(...args),
}));
vi.mock("@/lib/workspace-prisma", () => ({
  getWorkspacePrisma: () => getWorkspacePrisma(),
}));

const { refuse, rule, succeed } = await import("@/lib/workspace/rule");

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The wrapper exists for one reason: every rule had written the same try/catch
 * by hand, and `listTaxPeriods` had not — so a database error there threw into
 * the route as a 500 with nothing in the error log, while its neighbours all
 * reported `failed` and recorded the cause.
 */
describe("rule", () => {
  it("passes the workspace client to the body", async () => {
    const body = vi.fn(async () => succeed(1));
    await rule("ctx", body);
    expect(body).toHaveBeenCalledWith({
      prisma: { marker: "client" },
      encrypted: false,
    });
  });

  it("returns what the body returned", async () => {
    await expect(rule("ctx", async () => succeed("value"))).resolves.toEqual({
      ok: true,
      data: "value",
    });
    await expect(
      rule("ctx", async () => refuse("not_found")),
    ).resolves.toMatchObject({ ok: false, reason: "not_found" });
  });

  it("turns a thrown error into a refusal instead of propagating it", async () => {
    const result = await rule("myRule", async () => {
      throw new Error("connection lost");
    });

    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(recordError).toHaveBeenCalledWith("myRule", expect.any(Error));
  });

  it("catches a failure opening the client, not just one inside the body", async () => {
    // getWorkspacePrisma reaches the session and the data key, both of which
    // can fail before any query runs.
    getWorkspacePrisma.mockRejectedValueOnce(new Error("no session"));

    await expect(rule("myRule", async () => succeed(1))).resolves.toMatchObject(
      { ok: false, reason: "failed" },
    );
  });

  it("does not log an expected refusal", async () => {
    // A duplicate row and a client still in use are outcomes, not incidents.
    // Logging them would bury the errors that matter.
    await rule("ctx", async () => {
      throw { code: "P2002" };
    });
    await rule("ctx", async () => {
      throw { code: "P2003" };
    });

    expect(recordError).not.toHaveBeenCalled();
  });
});
