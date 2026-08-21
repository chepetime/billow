import { Prisma } from "@billow/db/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getWorkspacePrisma = vi.fn();
const getPrisma = vi.fn();

vi.mock("@/lib/workspace-prisma", () => ({
  getWorkspacePrisma: () => getWorkspacePrisma(),
}));

vi.mock("@billow/db", () => ({
  getPrisma: () => getPrisma(),
}));

const {
  RECENT_INVOICE_LIMIT,
  currentMonthRange,
  getInvoiceById,
  getInvoiceWorkspace,
} = await import("@/lib/invoice-workspace");

type Status = "DRAFT" | "SENT" | "PAID" | "VOID";

type Seed = {
  id: number;
  invoiceNumber: number;
  invoiceDate: Date;
  status: Status;
  userId: string;
  amounts: number[];
};

/**
 * A fake that evaluates the `where` clauses rather than returning canned rows.
 *
 * The whole point of this change is that the list is truncated while the totals
 * are not, so a fake that ignored filters could not tell a correct aggregate
 * from one accidentally scoped to the truncated page — which is precisely the
 * regression these tests exist to catch. `take` is deliberately not defaulted:
 * an unbounded `findMany` returns every row here, exactly as it would in
 * Postgres, and the bound assertions fail.
 */
function fakePrisma(seeds: Seed[]) {
  const listQueries: { take?: number }[] = [];
  const aggregateQueries: Record<string, unknown>[] = [];

  const matchesInvoice = (
    seed: Seed,
    where: {
      userId?: string;
      status?: Status | { notIn?: Status[] };
      invoiceDate?: { gte?: Date; lt?: Date };
    },
  ) => {
    if (where.userId !== undefined && seed.userId !== where.userId)
      return false;

    if (typeof where.status === "string" && seed.status !== where.status) {
      return false;
    }
    if (
      where.status &&
      typeof where.status === "object" &&
      where.status.notIn?.includes(seed.status)
    ) {
      return false;
    }

    const date = where.invoiceDate;
    if (date?.gte && seed.invoiceDate.getTime() < date.gte.getTime()) {
      return false;
    }
    if (date?.lt && seed.invoiceDate.getTime() >= date.lt.getTime()) {
      return false;
    }

    return true;
  };

  const prisma = {
    appMetadata: { findUnique: async () => null },
    userProfile: { findMany: async () => [{ id: 1 }] },
    bankAccount: { findMany: async () => [{ id: 1 }] },
    clientCompany: { findMany: async () => [{ id: 1 }] },
    invoice: {
      findMany: async (args: { where: { userId: string }; take?: number }) => {
        listQueries.push({ take: args.take });
        return seeds
          .filter((seed) => matchesInvoice(seed, args.where))
          .sort(
            (a, b) =>
              b.invoiceDate.getTime() - a.invoiceDate.getTime() ||
              b.invoiceNumber - a.invoiceNumber,
          )
          .slice(0, args.take)
          .map((seed) => ({
            id: seed.id,
            invoiceNumber: seed.invoiceNumber,
            invoiceDate: seed.invoiceDate,
            status: seed.status,
            clientCompany: { id: 1, name: "Acme Co" },
            lineItems: seed.amounts.map((amount, index) => ({
              id: index,
              amount: new Prisma.Decimal(amount),
            })),
          }));
      },
      count: async (args: { where: { userId: string } }) =>
        seeds.filter((seed) => matchesInvoice(seed, args.where)).length,
      findFirst: async (args: { where: { userId: string } }) => {
        const matches = seeds
          .filter((seed) => matchesInvoice(seed, args.where))
          .sort((a, b) => b.invoiceNumber - a.invoiceNumber);
        return matches[0] ? { invoiceNumber: matches[0].invoiceNumber } : null;
      },
    },
    invoiceLineItem: {
      aggregate: async (args: {
        where: { invoice: Record<string, unknown> };
      }) => {
        aggregateQueries.push(args as unknown as Record<string, unknown>);
        const matched = seeds.filter((seed) =>
          matchesInvoice(seed, args.where.invoice),
        );
        const amounts = matched.flatMap((seed) => seed.amounts);
        // Postgres returns NULL, not 0, when SUM() sees no rows at all.
        return {
          _sum: {
            amount: amounts.length
              ? new Prisma.Decimal(amounts.reduce((sum, n) => sum + n, 0))
              : null,
          },
        };
      },
    },
  };

  return { prisma, listQueries, aggregateQueries };
}

// Fixed clock: every date below is constructed in server-local time, matching
// how `currentMonthRange` derives its boundaries.
const NOW = new Date(2026, 6, 15, 12, 0, 0); // 15 July 2026

function seed(overrides: Partial<Seed> & { id: number }): Seed {
  return {
    invoiceNumber: overrides.id,
    invoiceDate: new Date(2026, 6, 10),
    status: "SENT",
    userId: "user-1",
    amounts: [100],
    ...overrides,
  };
}

function install(seeds: Seed[]) {
  const fake = fakePrisma(seeds);
  getWorkspacePrisma.mockResolvedValue({
    prisma: fake.prisma,
    encrypted: true,
  });
  return fake;
}

beforeEach(() => {
  getWorkspacePrisma.mockReset();
  getPrisma.mockReset();
});

describe("getInvoiceById", () => {
  it("reads through the session's data key, not the plain client", async () => {
    // If getInvoiceById fell back to the plain client, this is what it would
    // see: the raw encv1. envelope Postgres actually holds, undecrypted.
    getPrisma.mockReturnValue({
      invoice: {
        findFirst: async () => ({
          id: 1,
          userId: "user-1",
          userProfile: { taxId: "encv1.raw-ciphertext" },
          bankAccount: { accountNumber: "encv1.raw-ciphertext" },
          clientCompany: { name: "Wrong Co" },
          lineItems: [],
          revisions: [],
        }),
      },
    });
    getWorkspacePrisma.mockResolvedValue({
      encrypted: true,
      prisma: {
        invoice: {
          findFirst: async () => ({
            id: 1,
            userId: "user-1",
            userProfile: { taxId: "decrypted-tax-id" },
            bankAccount: { accountNumber: "decrypted-account-number" },
            clientCompany: { name: "Acme Co" },
            lineItems: [],
            revisions: [],
          }),
        },
      },
    });

    const invoice = await getInvoiceById(1, "user-1");

    expect(invoice?.userProfile.taxId).toBe("decrypted-tax-id");
    expect(invoice?.bankAccount.accountNumber).toBe("decrypted-account-number");
  });

  it("surfaces encrypted: false so the page can warn instead of printing ciphertext", async () => {
    getWorkspacePrisma.mockResolvedValue({
      encrypted: false,
      prisma: {
        invoice: {
          findFirst: async () => ({
            id: 1,
            userId: "user-1",
            userProfile: { taxId: "encv1.locked" },
            bankAccount: { accountNumber: "encv1.locked" },
            clientCompany: { name: "Acme Co" },
            lineItems: [],
            revisions: [],
          }),
        },
      },
    });

    const invoice = await getInvoiceById(1, "user-1");

    expect(invoice?.encrypted).toBe(false);
  });
});

describe("currentMonthRange", () => {
  it("spans the first instant of the month to the first of the next", () => {
    expect(currentMonthRange(NOW)).toEqual({
      gte: new Date(2026, 6, 1),
      lt: new Date(2026, 7, 1),
    });
  });

  it("rolls December over into the next January", () => {
    expect(currentMonthRange(new Date(2026, 11, 20))).toEqual({
      gte: new Date(2026, 11, 1),
      lt: new Date(2027, 0, 1),
    });
  });
});

describe("getInvoiceWorkspace totals", () => {
  it("aggregates every invoice while the list stops at the limit", async () => {
    // 40 invoices of 100 each, all this month and all open. If the totals were
    // still reduced from the returned list they would read 800, not 4000 —
    // that gap is the regression this test exists to pin down.
    const seeds = Array.from({ length: 40 }, (_, index) =>
      seed({ id: index + 1, invoiceDate: new Date(2026, 6, 1 + (index % 28)) }),
    );
    const fake = install(seeds);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.recentInvoices).toHaveLength(RECENT_INVOICE_LIMIT);
    expect(workspace.stats.invoiceCount).toBe(40);
    expect(workspace.stats.openTotal).toBe(4000);
    expect(workspace.stats.currentTotal).toBe(4000);

    // The bound must come from the query, not from slicing afterwards.
    expect(fake.listQueries).toEqual([{ take: RECENT_INVOICE_LIMIT }]);
  });

  it("never bounds the aggregate queries", async () => {
    const fake = install([seed({ id: 1 })]);

    await getInvoiceWorkspace("user-1", NOW);

    expect(fake.aggregateQueries).toHaveLength(3);
    for (const query of fake.aggregateQueries) {
      expect(query.take).toBeUndefined();
      expect(query.skip).toBeUndefined();
    }
  });

  it("counts DRAFT and SENT as open, and excludes PAID and VOID", async () => {
    install([
      seed({ id: 1, status: "DRAFT", amounts: [10] }),
      seed({ id: 2, status: "SENT", amounts: [20] }),
      seed({ id: 3, status: "PAID", amounts: [40] }),
      seed({ id: 4, status: "VOID", amounts: [80] }),
    ]);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.stats.openTotal).toBe(30);
    expect(workspace.stats.paidTotal).toBe(40);
    // VOID is in neither bucket, but still in the count and this month's total.
    expect(workspace.stats.currentTotal).toBe(150);
    expect(workspace.stats.invoiceCount).toBe(4);
  });

  it("sums every line item on an invoice, not just the first", async () => {
    install([seed({ id: 1, amounts: [1.5, 2.25, 3] })]);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.stats.openTotal).toBe(6.75);
    expect(workspace.recentInvoices[0].total).toBe(6.75);
  });

  it("keeps this month's total to the calendar month around the clock", async () => {
    install([
      // Last instant of June and first of August: both must fall outside.
      seed({ id: 1, invoiceDate: new Date(2026, 5, 30, 23, 59, 59) }),
      seed({ id: 2, invoiceDate: new Date(2026, 6, 1, 0, 0, 0) }),
      seed({ id: 3, invoiceDate: new Date(2026, 6, 31, 23, 59, 59) }),
      seed({ id: 4, invoiceDate: new Date(2026, 7, 1, 0, 0, 0) }),
    ]);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.stats.currentTotal).toBe(200);
    expect(workspace.stats.openTotal).toBe(400);
  });

  it("scopes every total to the signed-in user", async () => {
    install([
      seed({ id: 1, amounts: [100] }),
      seed({ id: 2, userId: "user-2", amounts: [999] }),
    ]);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.stats.openTotal).toBe(100);
    expect(workspace.stats.currentTotal).toBe(100);
    expect(workspace.stats.invoiceCount).toBe(1);
  });

  it("reports zero rather than NaN when a bucket matches no rows", async () => {
    install([]);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.stats).toEqual({
      invoiceCount: 0,
      currentTotal: 0,
      openTotal: 0,
      paidTotal: 0,
    });
    expect(workspace.recentInvoices).toEqual([]);
    expect(workspace.nextInvoiceNumber).toBe(1);
  });

  it("degrades to zeroed stats and an empty list when the database is down", async () => {
    getWorkspacePrisma.mockRejectedValue(new Error("no database"));

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.databaseAvailable).toBe(false);
    expect(workspace.recentInvoices).toEqual([]);
    expect(workspace.stats.openTotal).toBe(0);
  });
});
