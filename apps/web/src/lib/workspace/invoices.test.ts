import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  invoice: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  invoiceLineItem: { deleteMany: vi.fn() },
  invoiceRevision: { create: vi.fn() },
  userProfile: { findFirst: vi.fn() },
  bankAccount: { findFirst: vi.fn() },
  clientCompany: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
};

const prisma = {
  ...tx,
  invoiceLineItem: { ...tx.invoiceLineItem, groupBy: vi.fn() },
  $transaction: vi.fn(
    async (fn: (client: typeof tx) => unknown) => await fn(tx),
  ),
};

vi.mock("@/lib/workspace-prisma", () => ({
  getWorkspacePrisma: async () => ({ prisma, encrypted: false as const }),
}));
vi.mock("@/lib/error-log", () => ({ recordError: vi.fn() }));

const { createInvoice, deleteInvoice, getInvoice, updateInvoice } =
  await import("@/lib/workspace/invoices");

const OWNER = "user-1";
const PUBLIC_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const validInput = {
  userProfileId: 1,
  bankAccountId: 2,
  clientCompanyId: 3,
  invoiceNumber: 7,
  invoiceDate: "2026-03-31",
  currency: "MXN",
  status: "DRAFT",
  notes: null,
  lineItems: [{ description: "Work", note: null, quantity: 2, rate: 50 }],
};

function referencesAreOwned() {
  tx.userProfile.findFirst.mockResolvedValue({ id: 1 });
  tx.bankAccount.findFirst.mockResolvedValue({ id: 2 });
  tx.clientCompany.findFirst.mockResolvedValue({ id: 3 });
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.user.findUnique.mockResolvedValue({ name: "Jo", email: "jo@example.com" });
  prisma.invoice.findFirst.mockResolvedValue({
    publicId: PUBLIC_ID,
    lineItems: [],
    documents: [],
    clientCompany: { id: 3, name: "Acme" },
    invoiceDate: new Date(2026, 2, 31),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

/**
 * An opaque id is only opaque if a bad one cannot be told from a missing one.
 * Answering differently would let a caller probe which UUIDs exist.
 */
describe("public id handling", () => {
  it.each(["", "12", "not-a-uuid", "../../etc/passwd"])(
    "refuses %j as not_found, without querying",
    async (id) => {
      await expect(getInvoice(OWNER, id)).resolves.toMatchObject({
        ok: false,
        reason: "not_found",
      });
      expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
    },
  );

  it("refuses a malformed id on delete too", async () => {
    await expect(deleteInvoice(OWNER, "nope")).resolves.toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(prisma.invoice.deleteMany).not.toHaveBeenCalled();
  });
});

/**
 * Without this an id posted straight at the API would attach another account's
 * bank details to an invoice — the check the server action already carried,
 * now on the path an API key reaches.
 */
describe("reference ownership", () => {
  it("refuses when the bank account belongs to someone else", async () => {
    tx.userProfile.findFirst.mockResolvedValue({ id: 1 });
    tx.bankAccount.findFirst.mockResolvedValue(null);
    tx.clientCompany.findFirst.mockResolvedValue({ id: 3 });

    await expect(
      createInvoice(OWNER, validInput, { via: "apiKey" }),
    ).resolves.toMatchObject({ ok: false, reason: "not_found" });
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });

  it("scopes all three lookups to the caller", async () => {
    referencesAreOwned();
    tx.invoice.create.mockResolvedValue({ id: 10, publicId: PUBLIC_ID });

    await createInvoice(OWNER, validInput, { via: "session" });

    expect(tx.userProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, userId: OWNER } }),
    );
    expect(tx.bankAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 2, userProfile: { userId: OWNER } },
      }),
    );
    expect(tx.clientCompany.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3, userId: OWNER } }),
    );
  });
});

describe("revisions", () => {
  it("records the first revision alongside the invoice", async () => {
    referencesAreOwned();
    tx.invoice.create.mockResolvedValue({ id: 10, publicId: PUBLIC_ID });

    await createInvoice(OWNER, validInput, { via: "session" });

    expect(tx.invoiceRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revisionNumber: 1,
          editor: "Jo",
          summary: "Created invoice.",
        }),
      }),
    );
  });

  it("marks an edit made with an API key", async () => {
    // A revision is an audit trail. An edit by a key left running in a script
    // must not look like one the account owner made by hand.
    referencesAreOwned();
    tx.invoice.create.mockResolvedValue({ id: 10, publicId: PUBLIC_ID });

    await createInvoice(OWNER, validInput, { via: "apiKey" });

    expect(tx.invoiceRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ editor: "Jo (API key)" }),
      }),
    );
  });

  it("numbers an update from the highest existing revision", async () => {
    referencesAreOwned();
    tx.invoice.findFirst.mockResolvedValue({
      id: 10,
      status: "SENT",
      lineItems: [],
      revisions: [{ revisionNumber: 4 }],
      invoiceNumber: 7,
      invoiceDate: new Date(2026, 2, 31),
      currency: "MXN",
      notes: null,
      sentAt: null,
      approvedAt: null,
      paidAt: null,
      cfdiIssuedAt: null,
      userProfileId: 1,
      bankAccountId: 2,
      clientCompanyId: 3,
    });

    await updateInvoice(OWNER, PUBLIC_ID, validInput, { via: "session" });

    expect(tx.invoiceRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revisionNumber: 5 }),
      }),
    );
  });

  it("carries the existing status forward: an edit is not a status change", async () => {
    referencesAreOwned();
    tx.invoice.findFirst.mockResolvedValue({
      id: 10,
      status: "PAID",
      lineItems: [],
      revisions: [],
      invoiceNumber: 7,
      invoiceDate: new Date(2026, 2, 31),
      currency: "MXN",
      notes: null,
      sentAt: null,
      approvedAt: null,
      paidAt: null,
      cfdiIssuedAt: null,
      userProfileId: 1,
      bankAccountId: 2,
      clientCompanyId: 3,
    });

    await updateInvoice(
      OWNER,
      PUBLIC_ID,
      { ...validInput, status: "DRAFT" },
      { via: "session" },
    );

    expect(tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PAID" }),
      }),
    );
  });
});

describe("delete", () => {
  it("scopes by owner and public id together", async () => {
    prisma.invoice.deleteMany.mockResolvedValue({ count: 1 });

    await expect(deleteInvoice(OWNER, PUBLIC_ID)).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(prisma.invoice.deleteMany).toHaveBeenCalledWith({
      where: { publicId: PUBLIC_ID, userId: OWNER },
    });
  });

  it("refuses another owner's invoice as not_found", async () => {
    prisma.invoice.deleteMany.mockResolvedValue({ count: 0 });

    await expect(deleteInvoice(OWNER, PUBLIC_ID)).resolves.toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("refusal reasons", () => {
  it("reports a reused invoice number as conflict", async () => {
    referencesAreOwned();
    tx.invoice.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(
      createInvoice(OWNER, validInput, { via: "session" }),
    ).resolves.toMatchObject({ ok: false, reason: "conflict" });
  });

  it("rejects an invalid invoice date without touching the database", async () => {
    const result = await createInvoice(
      OWNER,
      { ...validInput, invoiceDate: "2026-02-31" },
      { via: "session" },
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
