import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordError } from "@/lib/error-log";
import { deleteUserDirectory } from "@/lib/storage";

const calls: Array<{ operation: string; where?: unknown }> = [];
const getAdminSessionMock = vi.fn();

vi.mock("@billow/auth", () => ({
  getAdminSession: () => getAdminSessionMock(),
}));

function fakePrisma() {
  const deleteMany = (operation: string) => async (args: unknown) => {
    calls.push({ operation, where: (args as { where?: unknown }).where });
    return { count: 1 };
  };

  const tx = {
    invoice: { deleteMany: deleteMany("invoice.deleteMany") },
    taxPeriod: { deleteMany: deleteMany("taxPeriod.deleteMany") },
    clientCompany: { deleteMany: deleteMany("clientCompany.deleteMany") },
    userProfile: { deleteMany: deleteMany("userProfile.deleteMany") },
    upload: { deleteMany: deleteMany("upload.deleteMany") },
  };

  return {
    $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => {
      const result = await callback(tx);
      calls.push({ operation: "$transaction settled" });
      return result;
    },
  };
}

vi.mock("@billow/db", () => ({
  getPrisma: () => fakePrisma(),
}));

vi.mock("@/lib/storage", () => ({
  deleteUserDirectory: vi.fn(async () => {
    calls.push({ operation: "deleteUserDirectory" });
  }),
}));

vi.mock("@/lib/error-log", () => ({
  recordError: vi.fn(async () => {}),
}));

const { DELETE } = await import("./route");

function resetRequest(body: unknown) {
  return new Request("http://localhost/api/admin/workspace", {
    method: "DELETE",
    headers: {
      origin: "http://localhost",
      host: "localhost",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/admin/workspace", () => {
  beforeEach(() => {
    calls.length = 0;
    getAdminSessionMock.mockReset();
    getAdminSessionMock.mockResolvedValue({
      session: { user: { id: "user-1" } },
      admin: true,
    });
    vi.mocked(deleteUserDirectory).mockReset();
    vi.mocked(deleteUserDirectory).mockImplementation(async () => {
      calls.push({ operation: "deleteUserDirectory" });
    });
    vi.mocked(recordError).mockReset();
    vi.mocked(recordError).mockResolvedValue(undefined);
  });

  it("deletes only the importing user's workspace and keeps the account", async () => {
    const response = await DELETE(
      resetRequest({ confirmation: "DELETE WORKSPACE" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deleted: {
        invoices: 1,
        taxPeriods: 1,
        clientCompanies: 1,
        userProfiles: 1,
        uploads: 1,
      },
    });

    expect(calls.slice(0, 5)).toEqual([
      { operation: "invoice.deleteMany", where: { userId: "user-1" } },
      { operation: "taxPeriod.deleteMany", where: { userId: "user-1" } },
      { operation: "clientCompany.deleteMany", where: { userId: "user-1" } },
      { operation: "userProfile.deleteMany", where: { userId: "user-1" } },
      { operation: "upload.deleteMany", where: { userId: "user-1" } },
    ]);
    expect(calls.map(({ operation }) => operation)).toEqual([
      "invoice.deleteMany",
      "taxPeriod.deleteMany",
      "clientCompany.deleteMany",
      "userProfile.deleteMany",
      "upload.deleteMany",
      "$transaction settled",
      "deleteUserDirectory",
    ]);
    expect(deleteUserDirectory).toHaveBeenCalledWith("user-1");
  });

  it("requires the explicit destructive confirmation", async () => {
    const response = await DELETE(resetRequest({ confirmation: "DELETE" }));

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(deleteUserDirectory).not.toHaveBeenCalled();
  });

  it("requires an administrator session", async () => {
    getAdminSessionMock.mockResolvedValue({
      session: { user: { id: "user-1" } },
      admin: false,
    });

    const response = await DELETE(
      resetRequest({ confirmation: "DELETE WORKSPACE" }),
    );

    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("reports file cleanup failure without restoring deleted database rows", async () => {
    vi.mocked(deleteUserDirectory).mockRejectedValueOnce(
      new Error("disk unavailable"),
    );

    const response = await DELETE(
      resetRequest({ confirmation: "DELETE WORKSPACE" }),
    );

    expect(response.status).toBe(200);
    expect(recordError).toHaveBeenCalledWith(
      "admin.workspace.reset.files",
      expect.any(Error),
    );
  });
});
