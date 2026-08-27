import { beforeEach, describe, expect, it, vi } from "vitest";

const clientCompany = {
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  findFirst: vi.fn(),
};

vi.mock("@/lib/workspace-prisma", () => ({
  getWorkspacePrisma: async () => ({
    prisma: { clientCompany },
    encrypted: false as const,
  }),
}));

vi.mock("@/lib/error-log", () => ({ recordError: vi.fn() }));

const {
  createClientCompany,
  deleteClientCompany,
  getClientCompany,
  updateClientCompany,
} = await import("@/lib/workspace/clients");

const OWNER = "user-1";

const validInput = {
  name: "Acme",
  legalName: null,
  address1: "1 Main St",
  address2: null,
  cityStatePostal: "Springfield, IL 62701",
  country: "USA",
  email: "billing@acme.example",
  attentionTo: null,
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The property these cover is the one the split exists for: the owner is an
 * argument, and every statement carries it. A rule that reads a session
 * instead cannot be called by an API route at all; a rule that takes a userId
 * and then forgets to filter on it is worse, because it works.
 */
describe("ownership scoping", () => {
  it("stamps the owner onto a create", async () => {
    clientCompany.create.mockResolvedValueOnce({ id: 7 });

    const result = await createClientCompany(OWNER, validInput);

    expect(result).toEqual({ ok: true, data: { id: 7 } });
    expect(clientCompany.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: OWNER, name: "Acme" }),
      }),
    );
  });

  it("filters an update by owner and id together", async () => {
    clientCompany.updateMany.mockResolvedValueOnce({ count: 1 });

    await updateClientCompany(OWNER, 7, validInput);

    expect(clientCompany.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, userId: OWNER } }),
    );
  });

  it("filters a delete by owner and id together", async () => {
    clientCompany.deleteMany.mockResolvedValueOnce({ count: 1 });

    await deleteClientCompany(OWNER, 7);

    expect(clientCompany.deleteMany).toHaveBeenCalledWith({
      where: { id: 7, userId: OWNER },
    });
  });

  it("refuses another owner's row as not_found, never as forbidden", async () => {
    // A distinct reason here would leak that the row exists: the caller could
    // tell "not yours" from "no such client" by the status alone.
    clientCompany.updateMany.mockResolvedValueOnce({ count: 0 });
    clientCompany.deleteMany.mockResolvedValueOnce({ count: 0 });
    clientCompany.findFirst.mockResolvedValueOnce(null);

    await expect(updateClientCompany(OWNER, 7, validInput)).resolves.toEqual({
      ok: false,
      reason: "not_found",
      fields: undefined,
    });
    await expect(deleteClientCompany(OWNER, 7)).resolves.toEqual({
      ok: false,
      reason: "not_found",
      fields: undefined,
    });
    await expect(getClientCompany(OWNER, 7)).resolves.toEqual({
      ok: false,
      reason: "not_found",
      fields: undefined,
    });
  });
});

describe("refusal reasons", () => {
  it("reports invalid input with its field errors, and writes nothing", async () => {
    const result = await createClientCompany(OWNER, {
      ...validInput,
      email: "not-an-email",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
    expect(result.fields?.email).toBeDefined();
    expect(clientCompany.create).not.toHaveBeenCalled();
  });

  it("turns a foreign-key violation into in_use", async () => {
    // An invoice still points at the client. Invoices keep the billing details
    // they were issued with, so this refusal is the feature, not an error.
    clientCompany.deleteMany.mockRejectedValueOnce({ code: "P2003" });

    await expect(deleteClientCompany(OWNER, 7)).resolves.toMatchObject({
      ok: false,
      reason: "in_use",
    });
  });

  it("turns an unexpected failure into failed rather than throwing", async () => {
    // A rule that throws reaches a server action as a redacted digest and an
    // API route as an unhandled 500 with no log line. Both callers need this
    // to come back as a value.
    clientCompany.create.mockRejectedValueOnce(new Error("connection lost"));

    await expect(createClientCompany(OWNER, validInput)).resolves.toMatchObject(
      { ok: false, reason: "failed" },
    );
  });
});
