import { describe, expect, it, vi } from "vitest";

// The bug being closed: a failed send used to pass the recipient email
// straight into `recordError`'s `meta`, which lands in a table any admin can
// read (see error-log.ts). Exercising the route rather than just
// `redactMeta` in isolation is deliberate — the property under test is that
// this call site no longer *offers* the address at all, not merely that a
// downstream redaction would catch it if it did.
const RECIPIENT = "admin@example.com";

const recordErrorMock = vi.hoisted(() =>
  vi.fn(
    async (_context: string, _error: unknown, _meta?: unknown) => undefined,
  ),
);

vi.mock("@billow/auth", () => ({
  getAdminSession: vi.fn(async () => ({
    session: { user: { id: "user-1", email: RECIPIENT, name: "Admin" } },
    admin: true,
  })),
}));

const sendEmailMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: false, error: "Provider rejected the request." })),
);
const clearEmailVerificationMock = vi.hoisted(() =>
  vi.fn(async () => undefined),
);
const markEmailVerifiedMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@billow/email", () => ({
  sendEmail: sendEmailMock,
  clearEmailVerification: clearEmailVerificationMock,
  markEmailVerified: markEmailVerifiedMock,
}));

vi.mock("@billow/email/templates", () => ({
  TestEmail: () => null,
  testEmailText: () => "test",
}));

vi.mock("@/lib/api/request-origin", () => ({
  isSameOriginRequest: vi.fn(() => true),
}));

vi.mock("@/lib/app-metadata", () => ({
  getAppMetadata: vi.fn(async () => ({ name: "Billow" })),
}));

vi.mock("@/lib/error-log", () => ({ recordError: recordErrorMock }));

function post() {
  return new Request("http://umbrel.local:3000/api/settings/email/test", {
    method: "POST",
  });
}

describe("POST /api/settings/email/test", () => {
  it("records the failure without the recipient address in meta", async () => {
    const { POST } = await import("@/app/api/settings/email/test/route");
    const response = await POST(post());

    expect(response.status).toBe(502);
    expect(recordErrorMock).toHaveBeenCalledTimes(1);

    const [context, error, meta] = recordErrorMock.mock.calls[0];
    expect(context).toBe("settings.email.test");
    expect(error).toBeInstanceOf(Error);
    // No third argument at all — nothing for a future redaction gap to miss.
    expect(meta).toBeUndefined();

    const serializedCall = JSON.stringify(recordErrorMock.mock.calls[0]);
    expect(serializedCall).not.toContain(RECIPIENT);
  });
});
