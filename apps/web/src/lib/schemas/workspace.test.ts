import { describe, expect, it } from "vitest";

import {
  bankAccountSchema,
  clientCompanySchema,
  invoiceSchema,
  invoiceTotal,
  lineItemAmount,
  senderProfileSchema,
} from "@/lib/schemas/workspace";

const sender = {
  displayName: "Alex Doe",
  legalName: "Alex Doe",
  email: "alex@billow.test",
  address: "Av. Insurgentes Sur 123",
  taxId: "",
  department: "",
  manager: "",
};

const invoice = {
  userProfileId: 1,
  bankAccountId: 1,
  clientCompanyId: 1,
  invoiceNumber: 42,
  invoiceDate: "2026-03-31",
  currency: "MXN",
  status: "DRAFT",
  notes: "",
  lineItems: [
    { description: "Monthly services", note: "", quantity: 1, rate: 1000 },
  ],
};

describe("optional text", () => {
  it("becomes null rather than an empty string", () => {
    const parsed = senderProfileSchema.parse(sender);

    expect(parsed.taxId).toBeNull();
    expect(parsed.department).toBeNull();
    expect(parsed.manager).toBeNull();
  });

  it("trims before deciding a field is empty", () => {
    const parsed = senderProfileSchema.parse({ ...sender, taxId: "   " });
    expect(parsed.taxId).toBeNull();
  });

  it("keeps a real value and trims it", () => {
    const parsed = senderProfileSchema.parse({ ...sender, taxId: " RFC01 " });
    expect(parsed.taxId).toBe("RFC01");
  });
});

describe("senderProfileSchema", () => {
  it("requires the fields an invoice cannot render without", () => {
    for (const field of ["displayName", "legalName", "address"] as const) {
      const result = senderProfileSchema.safeParse({ ...sender, [field]: "" });
      expect(result.success, field).toBe(false);
    }
  });

  it("rejects a malformed email", () => {
    expect(
      senderProfileSchema.safeParse({ ...sender, email: "nope" }).success,
    ).toBe(false);
  });
});

describe("bankAccountSchema", () => {
  const bank = {
    userProfileId: 1,
    label: "Primary",
    bankName: "Bank of Test",
    accountHolderName: "Alex Doe",
    accountNumber: "4444555566",
    bankAddress: "",
    bankPhone: "",
    accountHolderAddress: "",
    accountType: "",
    institutionNumber: "",
    transitNumber: "",
    routingNumber: "",
    swift: "",
    iban: "",
    clabe: "",
    isDefault: false,
  };

  it("accepts a minimal account", () => {
    expect(bankAccountSchema.safeParse(bank).success).toBe(true);
  });

  it("requires a sender profile to hang off", () => {
    expect(
      bankAccountSchema.safeParse({ ...bank, userProfileId: 0 }).success,
    ).toBe(false);
  });
});

describe("clientCompanySchema", () => {
  it("requires a billing address and email", () => {
    const result = clientCompanySchema.safeParse({
      name: "Acme",
      legalName: "",
      address1: "",
      address2: "",
      cityStatePostal: "",
      country: "",
      email: "billing@acme.test",
      attentionTo: "",
      notes: "",
    });

    expect(result.success).toBe(false);
  });
});

describe("invoiceSchema", () => {
  it("accepts a well-formed invoice", () => {
    expect(invoiceSchema.safeParse(invoice).success).toBe(true);
  });

  it("requires at least one line item", () => {
    const result = invoiceSchema.safeParse({ ...invoice, lineItems: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid calendar date", () => {
    const result = invoiceSchema.safeParse({
      ...invoice,
      invoiceDate: "2026-02-31",
    });
    expect(result.success).toBe(false);
  });

  it("rejects money with more precision than the column stores", () => {
    const result = invoiceSchema.safeParse({
      ...invoice,
      lineItems: [{ description: "x", note: "", quantity: 1, rate: 10.005 }],
    });

    expect(result.success).toBe(false);
  });

  it("accepts two decimal places", () => {
    const result = invoiceSchema.safeParse({
      ...invoice,
      lineItems: [{ description: "x", note: "", quantity: 1, rate: 3846.26 }],
    });

    expect(result.success).toBe(true);
  });

  it("rejects a NaN produced by an empty number input", () => {
    const result = invoiceSchema.safeParse({
      ...invoice,
      lineItems: [
        { description: "x", note: "", quantity: Number.NaN, rate: 1 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("accepts the strings a form control actually submits", () => {
    // Selects and number inputs hand back text. Parsing has to succeed with
    // or without `valueAsNumber` on the register call, and produce numbers.
    const result = invoiceSchema.safeParse({
      ...invoice,
      userProfileId: "1",
      bankAccountId: "2",
      clientCompanyId: "3",
      invoiceNumber: "42",
      lineItems: [
        { description: "x", note: "", quantity: "2", rate: "1500.50" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data?.bankAccountId).toBe(2);
    expect(result.data?.invoiceNumber).toBe(42);
    expect(result.data?.lineItems[0]?.rate).toBe(1500.5);
  });

  it("gives an empty number field its own message, not a NaN", () => {
    const result = invoiceSchema.safeParse({ ...invoice, invoiceNumber: "" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Invoice number is required.",
    );
  });

  it("rejects an unknown currency", () => {
    expect(
      invoiceSchema.safeParse({ ...invoice, currency: "GBP" }).success,
    ).toBe(false);
  });
});

describe("totals", () => {
  it("snaps each line to cents so float noise never reaches the column", () => {
    // 1.1 * 3 is 3.3000000000000003, and Decimal(12,2) would store 3.30
    // either way — but the number is also what the preview and the total
    // print, so it is rounded here rather than left to the database.
    expect(lineItemAmount(3, 1.1)).toBe(3.3);
    expect(lineItemAmount(2.5, 10.1)).toBe(25.25);
    // Two-decimal inputs can still multiply out to four decimals.
    expect(lineItemAmount(1.05, 1.05)).toBe(1.1);
  });

  it("sums without float drift", () => {
    const total = invoiceTotal([
      { quantity: 1, rate: 50000 },
      { quantity: 1, rate: 2000 },
      { quantity: 1, rate: 1500.33 },
      { quantity: 1, rate: 1000 },
      { quantity: 1, rate: 500 },
      { quantity: 1, rate: 250.67 },
    ]);

    expect(total).toBe(55251);
  });

  it("stays exact where a naive sum would not", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in float, and three of those in a row
    // is what puts an invoice a cent out.
    expect(
      invoiceTotal([
        { quantity: 1, rate: 0.1 },
        { quantity: 1, rate: 0.2 },
      ]),
    ).toBe(0.3);
  });
});
