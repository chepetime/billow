import { describe, expect, it } from "vitest";

import {
  BANK_ACCOUNT_FIELDS,
  SEALED_FIELDS,
  SENDER_PROFILE_FIELDS,
} from "@/lib/schemas/references";

/**
 * These two lists are partial views of the app's only encrypted models. The
 * failure they guard is quiet: seal a new column, forget this file, and the
 * endpoint starts returning nulls where it used to return data — which reads
 * to a consumer as data loss, not as a boundary.
 *
 * Asserting against ENCRYPTED_FIELDS rather than a copied list means sealing a
 * column that is exposed here fails the tests instead.
 */
describe("no exposed field is encrypted", () => {
  it.each(SENDER_PROFILE_FIELDS)("UserProfile.%s is plaintext", (field) => {
    expect(SEALED_FIELDS.UserProfile ?? []).not.toContain(field);
  });

  it.each(BANK_ACCOUNT_FIELDS)("BankAccount.%s is plaintext", (field) => {
    expect(SEALED_FIELDS.BankAccount ?? []).not.toContain(field);
  });
});

describe("the sealed fields stay out", () => {
  it("never exposes the sender's tax id or address", () => {
    expect(SENDER_PROFILE_FIELDS).not.toContain("taxId");
    expect(SENDER_PROFILE_FIELDS).not.toContain("address");
  });

  it("never exposes any part of the account itself", () => {
    for (const field of SEALED_FIELDS.BankAccount ?? []) {
      expect(BANK_ACCOUNT_FIELDS).not.toContain(field);
    }
    // Named explicitly too: this is the list that matters if the model is
    // ever restructured and ENCRYPTED_FIELDS is edited in the same change.
    for (const field of ["accountNumber", "iban", "clabe", "swift"]) {
      expect(BANK_ACCOUNT_FIELDS).not.toContain(field);
    }
  });
});

describe("what the lists are for", () => {
  it("carries the ids an invoice references", () => {
    expect(SENDER_PROFILE_FIELDS).toContain("id");
    expect(BANK_ACCOUNT_FIELDS).toContain("id");
    // An invoice's bank account must belong to its sender profile, so a
    // caller picking a pair needs the link.
    expect(BANK_ACCOUNT_FIELDS).toContain("userProfileId");
  });
});

/**
 * Deleting is possible where creating and updating are not, and the reason is
 * worth pinning down: the encryption guard refuses a *write to a sealed
 * column*, and a delete writes none. Both models are bounded by the database
 * instead — Invoice.userProfileId and Invoice.bankAccountId are
 * onDelete: Restrict, so a row any invoice was issued against comes back
 * `in_use` rather than taking the invoice with it.
 */
describe("what the API can do to these models", () => {
  it("exposes no writable field, so a create or update has nothing to send", () => {
    // If this ever gains a POST or PUT, the sealed columns are required and
    // an API-key caller cannot supply them — the endpoint would 409 always.
    for (const field of SEALED_FIELDS.UserProfile ?? []) {
      expect(SENDER_PROFILE_FIELDS).not.toContain(field);
    }
    for (const field of SEALED_FIELDS.BankAccount ?? []) {
      expect(BANK_ACCOUNT_FIELDS).not.toContain(field);
    }
  });
});
