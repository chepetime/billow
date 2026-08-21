import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * exportWorkspace decrypts through the encrypted-aware client. A session with
 * no data key has no way to decrypt, so the only two honest outcomes are
 * "refuse" or "export ciphertext with no warning" — this test pins down that
 * the route takes the first, not the second, and never even reaches
 * exportWorkspace when it does.
 */

const getAdminSessionMock = vi.fn();
const getWorkspacePrismaMock = vi.fn();
const exportWorkspaceMock = vi.fn();

vi.mock("@billow/auth", () => ({
  getAdminSession: () => getAdminSessionMock(),
  holdsRecoveryKey: vi.fn(),
}));

vi.mock("@/lib/workspace-prisma", () => ({
  getWorkspacePrisma: () => getWorkspacePrismaMock(),
}));

vi.mock("@/lib/backup", () => ({
  exportWorkspace: (...args: unknown[]) => exportWorkspaceMock(...args),
  exportUploadRecords: vi.fn(async () => []),
}));

const { GET } = await import("./route");

function backupRequest() {
  return new Request("http://localhost/api/admin/backup");
}

describe("GET /api/admin/backup", () => {
  beforeEach(() => {
    getAdminSessionMock.mockReset();
    getWorkspacePrismaMock.mockReset();
    exportWorkspaceMock.mockReset();
    getAdminSessionMock.mockResolvedValue({
      session: { user: { id: "user-1" } },
      admin: true,
    });
  });

  it("refuses the export when the session has no data key", async () => {
    getWorkspacePrismaMock.mockResolvedValue({
      prisma: {},
      encrypted: false,
    });

    const response = await GET(backupRequest());

    expect(response.status).toBe(409);
    expect(exportWorkspaceMock).not.toHaveBeenCalled();
  });

  it("proceeds when the session can reach the data key", async () => {
    getWorkspacePrismaMock.mockResolvedValue({
      prisma: {},
      encrypted: true,
    });
    exportWorkspaceMock.mockResolvedValue({
      userProfiles: [],
      bankAccounts: [],
      clientCompanies: [],
      invoices: [],
    });

    const response = await GET(backupRequest());

    expect(response.status).toBe(200);
    expect(exportWorkspaceMock).toHaveBeenCalledWith("user-1", {});
  });
});
