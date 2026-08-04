import { describe, expect, it } from "vitest";

import { EMAIL_CAPABILITY_UNKNOWN, resolveEmailCapability } from "./capability";

const VERIFIED_AT = new Date("2026-07-29T10:00:00.000Z");

describe("resolveEmailCapability", () => {
  it("allows user email once a send has actually succeeded", () => {
    const result = resolveEmailCapability({
      configured: true,
      fromEmail: "billow@example.com",
      verifiedAt: VERIFIED_AT,
    });

    expect(result.canSendUserEmail).toBe(true);
    expect(result.blockedReason).toBeNull();
  });

  it("refuses when a key is stored but nothing has ever been delivered", () => {
    // The important case: an administrator pastes a key, never tests it, and
    // the sending domain turns out to be unverified. Advertising password
    // reset here would strand every user who tried it.
    const result = resolveEmailCapability({
      configured: true,
      fromEmail: "billow@example.com",
      verifiedAt: null,
    });

    expect(result.canSendUserEmail).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.blockedReason).toMatch(/no test message/i);
  });

  it("distinguishes an unreadable credential from a missing one", () => {
    // Reporting "no API key is stored" for a key that is stored but will not
    // decrypt sends the operator looking for the wrong problem — and on the
    // diagnostics page it sat directly above the key's own decryption error.
    const result = resolveEmailCapability({
      configured: false,
      fromEmail: "billow@example.com",
      verifiedAt: null,
      credentialUnreadable: true,
    });

    expect(result.canSendUserEmail).toBe(false);
    expect(result.blockedReason).toMatch(/cannot be decrypted/i);
    expect(result.blockedReason).not.toMatch(/no api key is stored/i);
  });

  it("refuses without a credential", () => {
    const result = resolveEmailCapability({
      configured: false,
      fromEmail: "billow@example.com",
      verifiedAt: null,
    });

    expect(result.canSendUserEmail).toBe(false);
    expect(result.blockedReason).toMatch(/no api key/i);
  });

  it("refuses without a sender address", () => {
    const result = resolveEmailCapability({
      configured: true,
      fromEmail: null,
      verifiedAt: null,
    });

    expect(result.canSendUserEmail).toBe(false);
    expect(result.blockedReason).toMatch(/sender address/i);
  });

  it("refuses when a stale verification outlives the credential", () => {
    // Removing the key must immediately withdraw the feature, even though a
    // send succeeded at some point in the past.
    const result = resolveEmailCapability({
      configured: false,
      fromEmail: "billow@example.com",
      verifiedAt: VERIFIED_AT,
    });

    expect(result.canSendUserEmail).toBe(false);
  });

  it("accepts a serialized timestamp", () => {
    expect(
      resolveEmailCapability({
        configured: true,
        fromEmail: "billow@example.com",
        verifiedAt: VERIFIED_AT.toISOString(),
      }).canSendUserEmail,
    ).toBe(true);
  });

  it("treats an empty sender address as absent", () => {
    expect(
      resolveEmailCapability({
        configured: true,
        fromEmail: "",
        verifiedAt: VERIFIED_AT,
      }).canSendUserEmail,
    ).toBe(false);
  });

  it("fails closed when the capability is unknown", () => {
    expect(EMAIL_CAPABILITY_UNKNOWN.canSendUserEmail).toBe(false);
  });
});
