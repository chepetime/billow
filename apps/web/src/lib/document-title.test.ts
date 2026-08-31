import { describe, expect, it } from "vitest";

import { invoiceDocumentTitle, toFilenameSlug } from "@/lib/document-title";

describe("toFilenameSlug", () => {
  it("folds accents rather than dropping the letters", () => {
    expect(toFilenameSlug("José Manuel Gulías Lugo")).toBe(
      "Jose_Manuel_Gulias_Lugo",
    );
  });

  it("collapses the punctuation a company name carries", () => {
    // What Chrome would otherwise leave in the saved filename as
    // "Acme_ S.A. de C.V.pdf".
    expect(toFilenameSlug("Acme, S.A. de C.V.")).toBe("Acme_S_A_de_C_V");
  });

  it("leaves no leading or trailing separator", () => {
    expect(toFilenameSlug("  ¡Hola!  ")).toBe("Hola");
  });
});

describe("invoiceDocumentTitle", () => {
  const invoice = (invoiceDate: Date) => ({
    invoiceNumber: 12,
    invoiceDate,
    userProfile: { legalName: "José Manuel Gulías Lugo" },
  });

  it("names the file after the invoice, the issuer and the date", () => {
    expect(invoiceDocumentTitle(invoice(new Date(2026, 7, 31)))).toBe(
      "Invoice-12-Jose_Manuel_Gulias_Lugo-2026-08-31",
    );
  });

  it("files an invoice under the day it is dated, not the UTC day", () => {
    // Local midnight on the 1st is the previous day in UTC anywhere west of
    // Greenwich, which `toISOString` would happily file it under.
    expect(invoiceDocumentTitle(invoice(new Date(2026, 2, 1)))).toContain(
      "2026-03-01",
    );
  });

  it("drops the issuer rather than emitting a dangling separator", () => {
    expect(
      invoiceDocumentTitle({
        invoiceNumber: 3,
        invoiceDate: new Date(2026, 0, 9),
        userProfile: { legalName: "—" },
      }),
    ).toBe("Invoice-3-2026-01-09");
  });
});
