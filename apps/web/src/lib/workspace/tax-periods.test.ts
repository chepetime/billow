import { beforeEach, describe, expect, it, vi } from "vitest";

const taxPeriod = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
};

vi.mock("@/lib/workspace-prisma", () => ({
  getWorkspacePrisma: async () => ({
    prisma: { taxPeriod },
    encrypted: false as const,
  }),
}));

vi.mock("@/lib/error-log", () => ({ recordError: vi.fn() }));

const { createTaxPeriod, deleteTaxPeriod, getTaxPeriod, updateTaxPeriod } =
  await import("@/lib/workspace/tax-periods");

const OWNER = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ownership scoping", () => {
  it("stamps the owner onto a create", async () => {
    taxPeriod.create.mockResolvedValueOnce({ id: 4 });

    await createTaxPeriod(OWNER, { year: 2026, month: 3 });

    expect(taxPeriod.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: OWNER, year: 2026, month: 3 }),
      }),
    );
  });

  it("filters an update by owner and id together", async () => {
    taxPeriod.updateMany.mockResolvedValueOnce({ count: 1 });

    await updateTaxPeriod(OWNER, 4, { year: 2026, month: 3 });

    expect(taxPeriod.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 4, userId: OWNER } }),
    );
  });

  it("refuses another owner's period as not_found", async () => {
    taxPeriod.findFirst.mockResolvedValue(null);
    taxPeriod.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(getTaxPeriod(OWNER, 4)).resolves.toMatchObject({
      ok: false,
      reason: "not_found",
    });
    await expect(
      updateTaxPeriod(OWNER, 4, { year: 2026, month: 3 }),
    ).resolves.toMatchObject({ ok: false, reason: "not_found" });
    await expect(deleteTaxPeriod(OWNER, 4)).resolves.toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });
});

/**
 * The database would cascade TaxPeriodDocument rows away with the period,
 * orphaning the uploads they point at. Nothing in Postgres stops that — unlike
 * ClientCompany, which gets the same protection from onDelete: Restrict — so
 * the rule has to, and that is what makes DELETE safe for an unscoped key.
 */
describe("delete is refused while documents are attached", () => {
  it("refuses in_use and issues no delete at all", async () => {
    taxPeriod.findFirst.mockResolvedValueOnce({
      id: 4,
      _count: { documents: 1 },
    });

    await expect(deleteTaxPeriod(OWNER, 4)).resolves.toMatchObject({
      ok: false,
      reason: "in_use",
    });
    expect(taxPeriod.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes a period with no documents, still scoped by owner", async () => {
    taxPeriod.findFirst.mockResolvedValueOnce({
      id: 4,
      _count: { documents: 0 },
    });
    taxPeriod.deleteMany.mockResolvedValueOnce({ count: 1 });

    await expect(deleteTaxPeriod(OWNER, 4)).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(taxPeriod.deleteMany).toHaveBeenCalledWith({
      where: { id: 4, userId: OWNER },
    });
  });
});

describe("date handling", () => {
  it("stores a calendar day as local midnight, not UTC", async () => {
    // new Date("2026-03-01") is UTC midnight, which is February 28 in Mexico
    // City and falls out of currentMonthRange's March bucket.
    taxPeriod.create.mockResolvedValueOnce({ id: 4 });

    await createTaxPeriod(OWNER, {
      year: 2026,
      month: 3,
      filedAt: "2026-03-01",
    });

    const data = taxPeriod.create.mock.calls[0][0].data;
    expect(data.filedAt.getFullYear()).toBe(2026);
    expect(data.filedAt.getMonth()).toBe(2);
    expect(data.filedAt.getDate()).toBe(1);
    expect(data.filedAt.getHours()).toBe(0);
  });
});

describe("refusal reasons", () => {
  it("reports a duplicate month as conflict, never an overwrite", async () => {
    // The @@unique([userId, year, month]) violation. Upserting here would let
    // a retried request silently replace a filing date.
    taxPeriod.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(
      createTaxPeriod(OWNER, { year: 2026, month: 3 }),
    ).resolves.toMatchObject({ ok: false, reason: "conflict" });
  });

  it("reports invalid input with field errors and writes nothing", async () => {
    const result = await createTaxPeriod(OWNER, { year: 2026, month: 13 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
    expect(result.fields?.month).toBeDefined();
    expect(taxPeriod.create).not.toHaveBeenCalled();
  });
});
