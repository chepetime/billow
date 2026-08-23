import { describe, expect, it } from "vitest";

import { BACKUP_FORMAT_VERSION, parseBackupPayload } from "@/lib/backup";

function validPayload() {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: "2026-07-01T00:00:00.000Z",
    data: {
      userProfiles: [
        {
          id: 1,
          displayName: "Alex Doe",
          legalName: "Alex Doe",
          email: "alex@billow.test",
          taxId: null,
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
          accountHolderAddress: null,
          accountNumber: "0001",
          accountType: null,
          institutionNumber: null,
          transitNumber: null,
          routingNumber: null,
          swift: null,
          iban: null,
          clabe: null,
          isDefault: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      clientCompanies: [
        {
          id: 20,
          name: "Acme Co",
          legalName: null,
          address1: "456 Side St",
          address2: null,
          cityStatePostal: "Testville, TS 00000",
          country: "US",
          email: "billing@acme.test",
          attentionTo: null,
          notes: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      invoices: [
        {
          id: 30,
          invoiceNumber: 1,
          invoiceDate: "2026-01-15T00:00:00.000Z",
          status: "DRAFT",
          currency: "MXN",
          notes: null,
          userProfileId: 1,
          bankAccountId: 10,
          clientCompanyId: 20,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lineItems: [
            {
              id: 40,
              description: "Consulting",
              note: null,
              quantity: 1,
              rate: 100,
              amount: 100,
              position: 0,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          revisions: [
            {
              id: 50,
              revisionNumber: 1,
              editor: "Alex Doe",
              summary: "Created",
              payload: { note: "initial" },
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    },
  };
}

describe("parseBackupPayload", () => {
  it("accepts a well-formed document", () => {
    const result = parseBackupPayload(validPayload());
    expect(result.success).toBe(true);
  });

  it("accepts dated progress and month-level tax documents", () => {
    const payload = validPayload();
    const timestamp = "2026-01-31T00:00:00.000Z";
    const result = parseBackupPayload({
      ...payload,
      data: {
        ...payload.data,
        invoices: [
          {
            ...payload.data.invoices[0],
            status: "DONE",
            sentAt: timestamp,
            approvedAt: timestamp,
            paidAt: timestamp,
            cfdiIssuedAt: timestamp,
            documents: [
              {
                uploadId: "cfdi-xml",
                kind: "CFDI_XML",
                note: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
              {
                uploadId: "cfdi-pdf",
                kind: "CFDI_PDF",
                note: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ],
          },
        ],
        taxPeriods: [
          {
            id: 60,
            year: 2026,
            month: 1,
            currency: "MXN",
            amountPaid: 1234.56,
            filedAt: timestamp,
            paidAt: timestamp,
            notes: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            documents: [
              {
                uploadId: "tax-return",
                kind: "TAX_RETURN",
                note: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ],
          },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects an unknown format version", () => {
    const payload = validPayload();
    const result = parseBackupPayload({ ...payload, formatVersion: 99 });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed invoice row missing required fields", () => {
    const payload = validPayload();
    const malformed = {
      ...payload,
      data: {
        ...payload.data,
        invoices: [
          {
            ...payload.data.invoices[0],
            userProfileId: undefined,
          },
        ],
      },
    };
    const result = parseBackupPayload(malformed);
    expect(result.success).toBe(false);
  });

  it("rejects a malformed bank account with the wrong field types", () => {
    const payload = validPayload();
    const malformed = {
      ...payload,
      data: {
        ...payload.data,
        bankAccounts: [
          {
            ...payload.data.bankAccounts[0],
            isDefault: "yes",
          },
        ],
      },
    };
    const result = parseBackupPayload(malformed);
    expect(result.success).toBe(false);
  });

  it("rejects a document that is missing the data envelope entirely", () => {
    const result = parseBackupPayload({
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
