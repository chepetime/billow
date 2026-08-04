import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertEncryptedFieldsSealed,
  ENCRYPTED_FIELDS,
  PlaintextEncryptedWriteError,
  sealEncryptedFields,
} from "@billow/db/field-encryption";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBankAccount } from "@/app/actions";
import { importWorkspace } from "@/lib/backup";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

// The plain client must be unreachable from either write path. Throwing from
// the mock is the assertion: if a call site reaches for it again, the test that
// exercises that path fails with this message rather than silently passing.
vi.mock("@billow/db", () => ({
  getPrisma: () => {
    throw new Error("getPrisma() reached from an encrypted write path");
  },
}));

vi.mock("@billow/auth", () => ({
  requireSession: async () => ({ user: { id: "user-1" } }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/workspace-prisma", () => ({ getWorkspacePrisma: vi.fn() }));

const DATA_KEY = Buffer.alloc(32, 7);

/** The envelope `@billow/crypto` writes: `encv1.<iv>.<tag>.<ciphertext>`. */
const SEALED = /^encv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

type Row = Record<string, unknown>;

const MODELS = {
  bankAccount: "BankAccount",
  userProfile: "UserProfile",
  clientCompany: "ClientCompany",
  invoice: "Invoice",
  invoiceLineItem: "InvoiceLineItem",
  invoiceRevision: "InvoiceRevision",
} as const;

/**
 * Stands in for whatever `getWorkspacePrisma()` hands back, running the real
 * sealing transform on every create so a test can inspect the row that would
 * have reached Postgres.
 *
 * A fake rather than a database because the question these tests answer —
 * "which client did this call site use?" — is settled before any SQL is sent,
 * and `pnpm test:run` has no Postgres.
 */
function fakeWorkspacePrisma() {
  const written: Record<string, Row[]> = {};

  const delegate = (name: keyof typeof MODELS) => ({
    create: async ({ data }: { data: Row }) => {
      const sealed = sealEncryptedFields(MODELS[name], DATA_KEY, {
        ...data,
      }) as Row;
      const rows = written[name] ?? [];
      rows.push(sealed);
      written[name] = rows;
      return { id: rows.length, ...sealed };
    },
    updateMany: async () => ({ count: 0 }),
    // Ownership checks and invoice-number collision probes. Only the profile
    // lookup has to succeed; a null invoice means "no collision".
    findFirst: async () => (name === "userProfile" ? { id: 1 } : null),
    findUnique: async () => null,
  });

  const models = Object.fromEntries(
    Object.keys(MODELS).map((name) => [
      name,
      delegate(name as keyof typeof MODELS),
    ]),
  );

  const client = {
    ...models,
    $transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(models),
  };

  return { written, client };
}

function useFakeWorkspacePrisma() {
  const { written, client } = fakeWorkspacePrisma();
  vi.mocked(getWorkspacePrisma).mockResolvedValue({
    prisma: client,
    encrypted: true,
  } as unknown as Awaited<ReturnType<typeof getWorkspacePrisma>>);
  return written;
}

function bankAccountForm() {
  const form = new FormData();
  form.set("userProfileId", "1");
  form.set("label", "Savings");
  form.set("bankName", "Bank of Test");
  form.set("accountHolderName", "Alex Doe");
  form.set("accountHolderAddress", "123 Main St");
  form.set("accountNumber", "4444555566");
  form.set("iban", "MX0000000000000001");
  form.set("clabe", "012345678901234567");
  form.set("swift", "TESTMXMM");
  form.set("routingNumber", "021000021");
  return form;
}

describe("the plaintext-write guard", () => {
  it("rejects a bank account written without encryption", () => {
    expect(() =>
      assertEncryptedFieldsSealed("create", {
        data: { label: "Primary", accountNumber: "4444555566" },
      }),
    ).toThrow(PlaintextEncryptedWriteError);
  });

  it("names every column that would have leaked", () => {
    let message = "";
    try {
      assertEncryptedFieldsSealed("create", {
        data: { accountNumber: "1", iban: "2", taxId: "3", bankName: "open" },
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("BankAccount.accountNumber");
    expect(message).toContain("BankAccount.iban");
    expect(message).toContain("UserProfile.taxId");
    expect(message).not.toContain("bankName");
  });

  it("accepts the same payload once it is sealed", () => {
    const sealed = sealEncryptedFields("BankAccount", DATA_KEY, {
      label: "Primary",
      accountNumber: "4444555566",
    });

    expect(() =>
      assertEncryptedFieldsSealed("create", { data: sealed }),
    ).not.toThrow();
  });

  it("catches a nested relation write, which the sealer cannot see", () => {
    // Prisma reports the parent model to `$allOperations`, so nothing in the
    // encrypting extension ever looks at the account below.
    expect(() =>
      assertEncryptedFieldsSealed("create", {
        data: {
          displayName: "Alex Doe",
          bankAccounts: { create: [{ accountNumber: "4444555566" }] },
        },
      }),
    ).toThrow(PlaintextEncryptedWriteError);
  });

  it("catches Prisma's `{ set: … }` longhand", () => {
    expect(() =>
      assertEncryptedFieldsSealed("update", {
        where: { id: 1 },
        data: { accountNumber: { set: "4444555566" } },
      }),
    ).toThrow(PlaintextEncryptedWriteError);
  });

  it("leaves reads and filters alone", () => {
    expect(() =>
      assertEncryptedFieldsSealed("findMany", {
        where: { accountNumber: "4444555566" },
      }),
    ).not.toThrow();
    expect(() =>
      assertEncryptedFieldsSealed("updateMany", {
        where: { accountNumber: "4444555566" },
        data: { isDefault: false },
      }),
    ).not.toThrow();
  });

  it("allows a write that touches no encrypted column", () => {
    // The seeded-data claim in packages/auth, which sets userId and nothing
    // else. It has no key to encrypt with and needs none.
    expect(() =>
      assertEncryptedFieldsSealed("updateMany", {
        where: { userId: null },
        data: { userId: "user-1" },
      }),
    ).not.toThrow();
  });
});

describe("write paths that reach encrypted columns", () => {
  beforeEach(() => {
    vi.mocked(getWorkspacePrisma).mockReset();
  });

  it("createBankAccount seals every encrypted column", async () => {
    const written = useFakeWorkspacePrisma();

    await createBankAccount(bankAccountForm());

    const row = written["bankAccount"]![0]!;
    for (const field of ENCRYPTED_FIELDS["BankAccount"]!) {
      const value = row[field];
      if (value === null || value === undefined) continue;
      expect(value, field).toMatch(SEALED);
    }
    expect(row["accountNumber"]).not.toContain("4444555566");
    // Not encrypted, and still readable — the guard is not a blanket.
    expect(row["label"]).toBe("Savings");
    expect(row["bankName"]).toBe("Bank of Test");
    expect(() =>
      assertEncryptedFieldsSealed("create", { data: row }),
    ).not.toThrow();
  });

  it("importWorkspace seals every restored bank account", async () => {
    const written = useFakeWorkspacePrisma();

    const summary = await importWorkspace("user-1", {
      userProfiles: [
        {
          id: 1,
          displayName: "Alex Doe",
          legalName: "Alex Doe",
          email: "alex@billow.test",
          taxId: "RFC000000000",
          address: "123 Main St",
          department: null,
          manager: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      bankAccounts: [
        {
          id: 10,
          userProfileId: 1,
          label: "Primary",
          bankName: "Bank of Test",
          bankAddress: null,
          bankPhone: null,
          accountHolderName: "Alex Doe",
          accountHolderAddress: "123 Main St",
          accountNumber: "0001",
          accountType: null,
          institutionNumber: "001",
          transitNumber: "00022",
          routingNumber: "021000021",
          swift: "TESTMXMM",
          iban: "MX0000000000000001",
          clabe: "012345678901234567",
          isDefault: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      clientCompanies: [],
      invoices: [],
      uploads: [],
    });

    expect(summary.bankAccounts).toBe(1);

    const account = written["bankAccount"]![0]!;
    for (const field of ENCRYPTED_FIELDS["BankAccount"]!) {
      expect(account[field], field).toMatch(SEALED);
    }
    expect(account["bankName"]).toBe("Bank of Test");

    const profile = written["userProfile"]![0]!;
    for (const field of ENCRYPTED_FIELDS["UserProfile"]!) {
      expect(profile[field], field).toMatch(SEALED);
    }
    expect(profile["displayName"]).toBe("Alex Doe");
  });
});

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

const WRITE_CALL = new RegExp(
  String.raw`(getPrisma\(\)|\w+)\.(bankAccount|userProfile)\.` +
    String.raw`(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert)\s*\(`,
  "g",
);

const ENCRYPTED_KEY = new RegExp(
  String.raw`\b(${Object.values(ENCRYPTED_FIELDS).flat().join("|")})\s*:`,
);

function sourceFiles(dir: string, found: string[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "generated") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, found);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      found.push(path);
    }
  }
  return found;
}

/** The call's argument text, from its opening paren to the matching close. */
function callArguments(source: string, openParen: number) {
  let depth = 0;
  for (let index = openParen; index < source.length; index++) {
    if (source[index] === "(") depth++;
    if (source[index] === ")" && --depth === 0)
      return source.slice(openParen, index + 1);
  }
  return source.slice(openParen);
}

/**
 * Where a client variable came from, following one `$transaction` hop, which
 * is the shape both audited bypasses had: `const prisma = getPrisma()` and
 * then `prisma.$transaction(async (tx) => tx.bankAccount.create(…))`.
 */
function clientOrigin(source: string, name: string, depth = 0): string {
  if (name === "getPrisma()") return "plain";
  if (depth > 2) return "unknown";
  if (new RegExp(String.raw`\b${name}\s*=\s*getPrisma\(\)`).test(source))
    return "plain";

  const transaction = new RegExp(
    String.raw`(\w+)\.\$transaction\(\s*async\s*\(\s*${name}\b`,
  ).exec(source);
  if (transaction) return clientOrigin(source, transaction[1]!, depth + 1);

  return "unknown";
}

/**
 * Nothing outside the encryption mechanism itself may write an encrypted
 * column through the plain client.
 *
 * A source check rather than a runtime one because the runtime guard can only
 * reach clients that carry the extension, and `getPrisma()` is exported to the
 * whole repo. Wiring the guard into `createPrismaClient()` would close that for
 * every consumer; until then this covers the gap, at the cost of being a
 * heuristic — it follows one `$transaction` hop and reads object literals, so
 * it recognises the two bypasses that shipped and the obvious ways to write
 * them again, not every possible one.
 */
function plainClientWrites(source: string) {
  const offenders: string[] = [];

  for (const match of source.matchAll(WRITE_CALL)) {
    const args = callArguments(source, match.index + match[0].length - 1);
    if (!ENCRYPTED_KEY.test(args)) continue;
    if (clientOrigin(source, match[1]!) === "plain") offenders.push(match[0]);
  }

  return offenders;
}

describe("no encrypted-column write through the plain client", () => {
  it("recognises the shape that shipped", () => {
    // Verbatim `createBankAccount` before this change, reduced to the parts
    // the check reads. Without this the check could pass by never matching
    // anything, which is the usual way a source guard rots.
    expect(
      plainClientWrites(`
        const prisma = getPrisma();
        await prisma.$transaction(async (tx) => {
          await tx.bankAccount.create({ data: { accountNumber: "0001" } });
        });
      `),
    ).toEqual(["tx.bankAccount.create("]);

    expect(
      plainClientWrites(`
        await getPrisma().userProfile.update({ data: { taxId: "x" } });
      `),
    ).toEqual(["getPrisma().userProfile.update("]);
  });

  it("passes for the whole repository", () => {
    const files = [
      ...sourceFiles(join(REPO_ROOT, "apps/web/src")),
      ...sourceFiles(join(REPO_ROOT, "packages")),
      // The mechanism itself is exempt: it holds the only sanctioned plain
      // client reference to these models, to read rows before sealing them.
    ].filter(
      (path) => !path.endsWith(join("db", "src", "field-encryption.ts")),
    );

    // A sanity check on the walk, not on the rule: a typo in a root path
    // would otherwise make this pass over nothing.
    expect(files.length).toBeGreaterThan(50);

    const offenders = files.flatMap((path) =>
      plainClientWrites(readFileSync(path, "utf8")).map(
        (call) => `${path.slice(REPO_ROOT.length)}: ${call}`,
      ),
    );

    expect(offenders).toEqual([]);
  });
});
