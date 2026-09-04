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

type Status =
  | "DRAFT"
  | "SENT"
  | "APPROVED"
  | "PAID"
  | "TAX_RECEIPT"
  | "TAX_RETURN"
  | "DONE"
  | "VOID";

type Seed = {
  id: number;
  publicId: string;
  invoiceNumber: number;
  invoiceDate: Date;
  status: Status;
  currency: string;
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
  const lineTotalQueries: Record<string, unknown>[] = [];

  const matchesInvoice = (
    seed: Seed,
    where: {
      userId?: string;
      status?: Status | { in?: Status[]; notIn?: Status[] };
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
    if (
      where.status &&
      typeof where.status === "object" &&
      where.status.in &&
      !where.status.in.includes(seed.status)
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
      findMany: async (args: {
        where: { userId: string };
        take?: number;
        include?: { lineItems?: unknown; documents?: unknown };
      }) => {
        if (args.include?.lineItems) listQueries.push({ take: args.take });
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
            publicId: seed.publicId,
            invoiceNumber: seed.invoiceNumber,
            invoiceDate: seed.invoiceDate,
            status: seed.status,
            currency: seed.currency,
            sentAt: null,
            approvedAt: null,
            paidAt: null,
            cfdiIssuedAt: null,
            clientCompany: { id: 1, name: "Acme Co" },
            documents: [],
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
      groupBy: async (args: {
        where: { invoice: Record<string, unknown> };
      }) => {
        lineTotalQueries.push(args as unknown as Record<string, unknown>);
        const matched = seeds.filter((seed) =>
          matchesInvoice(seed, args.where.invoice),
        );
        return matched.map((seed) => ({
          invoiceId: seed.id,
          _sum: {
            amount: seed.amounts.length
              ? new Prisma.Decimal(
                  seed.amounts.reduce((sum, amount) => sum + amount, 0),
                )
              : null,
          },
        }));
      },
    },
    taxPeriod: { findUnique: async () => null },
  };

  return { prisma, listQueries, lineTotalQueries };
}

// Fixed clock: every date below is constructed in server-local time, matching
// how `currentMonthRange` derives its boundaries.
const NOW = new Date(2026, 6, 15, 12, 0, 0); // 15 July 2026

function seed(overrides: Partial<Seed> & { id: number }): Seed {
  return {
    publicId: `00000000-0000-4000-8000-${overrides.id.toString().padStart(12, "0")}`,
    invoiceNumber: overrides.id,
    invoiceDate: new Date(2026, 6, 10),
    status: "SENT",
    currency: "MXN",
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

    const invoice = await getInvoiceById(
      "c4d76986-85ff-46eb-8e5e-83ab08c698a6",
      "user-1",
    );

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

    const invoice = await getInvoiceById(
      "c4d76986-85ff-46eb-8e5e-83ab08c698a6",
      "user-1",
    );

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
  it("exposes the opaque invoice ID instead of the internal integer key", async () => {
    const invoice = seed({ id: 17 });
    install([invoice]);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.recentInvoices[0]?.id).toBe(invoice.publicId);
  });

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
    expect(workspace.stats.openTotals).toEqual([
      { currency: "MXN", amount: 4000 },
    ]);
    expect(workspace.stats.currentTotals).toEqual([
      { currency: "MXN", amount: 4000 },
    ]);

    // The bound must come from the query, not from slicing afterwards.
    expect(fake.listQueries).toEqual([{ take: RECENT_INVOICE_LIMIT }]);
  });

  it("does not bound the grouped line-item totals query", async () => {
    const fake = install([seed({ id: 1 })]);

    await getInvoiceWorkspace("user-1", NOW);

    expect(fake.lineTotalQueries).toHaveLength(1);
    for (const query of fake.lineTotalQueries) {
      expect(query.take).toBeUndefined();
      expect(query.skip).toBeUndefined();
    }
  });

  it("counts DRAFT and SENT as open, and every post-payment state as paid", async () => {
    install([
      seed({ id: 1, status: "DRAFT", amounts: [10] }),
      seed({ id: 2, status: "SENT", amounts: [20] }),
      seed({ id: 3, status: "PAID", amounts: [40] }),
      seed({ id: 4, status: "TAX_RECEIPT", amounts: [80] }),
      seed({ id: 5, status: "TAX_RETURN", amounts: [160] }),
      seed({ id: 6, status: "DONE", amounts: [320] }),
      seed({ id: 7, status: "VOID", amounts: [640] }),
    ]);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.stats.openTotals).toEqual([
      { currency: "MXN", amount: 30 },
    ]);
    expect(workspace.stats.paidTotals).toEqual([
      { currency: "MXN", amount: 600 },
    ]);
    // VOID is in neither bucket, but still in the count and this month's total.
    expect(workspace.stats.currentTotals).toEqual([
      { currency: "MXN", amount: 1270 },
    ]);
    expect(workspace.stats.invoiceCount).toBe(7);
  });

  it("sums every line item on an invoice, not just the first", async () => {
    install([seed({ id: 1, amounts: [1.5, 2.25, 3] })]);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.stats.openTotals).toEqual([
      { currency: "MXN", amount: 6.75 },
    ]);
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

    expect(workspace.stats.currentTotals).toEqual([
      { currency: "MXN", amount: 200 },
    ]);
    expect(workspace.stats.openTotals).toEqual([
      { currency: "MXN", amount: 400 },
    ]);
  });

  it("scopes every total to the signed-in user", async () => {
    install([
      seed({ id: 1, amounts: [100] }),
      seed({ id: 2, userId: "user-2", amounts: [999] }),
    ]);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.stats.openTotals).toEqual([
      { currency: "MXN", amount: 100 },
    ]);
    expect(workspace.stats.currentTotals).toEqual([
      { currency: "MXN", amount: 100 },
    ]);
    expect(workspace.stats.invoiceCount).toBe(1);
  });

  it("reports zero rather than NaN when a bucket matches no rows", async () => {
    install([]);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.stats).toEqual({
      invoiceCount: 0,
      currentTotals: [],
      openTotals: [],
      paidTotals: [],
    });
    expect(workspace.recentInvoices).toEqual([]);
    expect(workspace.nextInvoiceNumber).toBe(1);
  });

  it("degrades to zeroed stats and an empty list when the database is down", async () => {
    getWorkspacePrisma.mockRejectedValue(new Error("no database"));

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.databaseAvailable).toBe(false);
    expect(workspace.recentInvoices).toEqual([]);
    expect(workspace.stats.openTotals).toEqual([]);
  });

  it("keeps each dashboard total in its invoice currency", async () => {
    install([
      seed({ id: 1, currency: "USD", amounts: [10], status: "SENT" }),
      seed({ id: 2, currency: "MXN", amounts: [20], status: "PAID" }),
      seed({ id: 3, currency: "EUR", amounts: [30], status: "VOID" }),
    ]);

    const workspace = await getInvoiceWorkspace("user-1", NOW);

    expect(workspace.stats.currentTotals).toEqual([
      { currency: "EUR", amount: 30 },
      { currency: "MXN", amount: 20 },
      { currency: "USD", amount: 10 },
    ]);
    expect(workspace.stats.openTotals).toEqual([
      { currency: "USD", amount: 10 },
    ]);
    expect(workspace.stats.paidTotals).toEqual([
      { currency: "MXN", amount: 20 },
    ]);
  });
});
