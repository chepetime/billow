import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteUserDirectory } from "@/lib/storage";

/**
 * Deletion order and the file-cleanup contract are the parts of this route
 * worth a test: the database rows must be gone before cleanup runs (see the
 * ordering comment in route.ts), and a cleanup failure must not turn a
 * successful account deletion into an error response.
 *
 * The transaction and session are faked rather than hit against a real
 * database — `pnpm test:run` has no Postgres — but every fake records into
 * `calls` so ordering is asserted on real call sequence, not assumed.
 */

const calls: string[] = [];

const getSessionMock = vi.fn();
const verifyPasswordMock = vi.fn();

vi.mock("@billow/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
    },
  },
}));

function fakePrisma() {
  const deleteMany = (label: string) => async () => {
    calls.push(label);
    return { count: 0 };
  };

  return {
    apikey: { deleteMany: deleteMany("apikey.deleteMany") },
    invoice: { deleteMany: deleteMany("invoice.deleteMany") },
    clientCompany: { deleteMany: deleteMany("clientCompany.deleteMany") },
    userProfile: { deleteMany: deleteMany("userProfile.deleteMany") },
    user: {
      delete: async () => {
        calls.push("user.delete");
        return { id: "user-1" };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => {
      const result = await Promise.all(ops);
      calls.push("$transaction settled");
      return result;
    },
  };
}

vi.mock("@billow/db", () => ({
  getPrisma: () => fakePrisma(),
}));

vi.mock("@/lib/storage", () => ({
  deleteUserDirectory: vi.fn(async () => {
    calls.push("deleteUserDirectory");
  }),
}));

const { DELETE } = await import("./route");

function deleteRequest(body: unknown) {
  return new Request("http://localhost/api/account", {
    method: "DELETE",
    headers: {
      origin: "http://localhost",
      host: "localhost",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/account", () => {
  beforeEach(() => {
    calls.length = 0;
    getSessionMock.mockReset();
    verifyPasswordMock.mockReset();
    vi.mocked(deleteUserDirectory).mockReset();
    vi.mocked(deleteUserDirectory).mockImplementation(async () => {
      calls.push("deleteUserDirectory");
    });

    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    verifyPasswordMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes the account and removes that user's upload directory, in that order", async () => {
    const response = await DELETE(
      deleteRequest({ password: "correct", confirmation: "DELETE" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    expect(vi.mocked(deleteUserDirectory)).toHaveBeenCalledWith("user-1");
    // The row deletion transaction must settle before cleanup starts — a
    // reversed order risks deleting files while the account (and its
    // Upload rows) still exist.
    expect(calls.indexOf("$transaction settled")).toBeLessThan(
      calls.indexOf("deleteUserDirectory"),
    );
  });

  it("still reports the account as deleted when file cleanup fails, and records the failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(deleteUserDirectory).mockRejectedValueOnce(
      new Error("disk unavailable"),
    );

    const response = await DELETE(
      deleteRequest({ password: "correct", confirmation: "DELETE" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]?.[0]).toContain("user-1");
  });

  it("never reaches file cleanup when the password confirmation fails", async () => {
    verifyPasswordMock.mockRejectedValueOnce(new Error("bad password"));

    const response = await DELETE(
      deleteRequest({ password: "wrong", confirmation: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(deleteUserDirectory)).not.toHaveBeenCalled();
  });
});
