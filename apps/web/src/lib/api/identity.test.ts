import { describe, expect, it, vi } from "vitest";

import { requireApiIdentity } from "@/lib/api/identity";

const API_KEY = "billow_test_key";
const KEY_OWNER = "user-from-api-key";
const SESSION_OWNER = "user-from-session";

/**
 * Mirrors the plugin's actual `{ valid, key, error }` return shape, including
 * the `code`/`details` the api-key plugin sets on a throttled key but does not
 * declare in its public types.
 */
type VerifyApiKeyResult = {
  valid: boolean;
  key: { referenceId: string; permissions?: unknown } | null;
  error?: {
    message: string;
    code?: string;
    details?: { tryAgainIn?: number };
  };
};

const authMock = vi.hoisted(() => ({
  verifyApiKey: vi.fn(
    async ({ body }: { body: { key: string } }): Promise<VerifyApiKeyResult> =>
      body.key === API_KEY
        ? {
            valid: true,
            key: {
              referenceId: KEY_OWNER,
              permissions: { billow: ["read", "write"] },
            },
          }
        : { valid: false, key: null, error: { message: "Invalid API key." } },
  ),
  // Every request in this file is treated as carrying a valid session cookie,
  // which is the situation the guard has to get right: an attacker's forged
  // request rides on a real session.
  getSession: vi.fn(
    async (): Promise<{ user: { id: string } } | null> => ({
      user: { id: SESSION_OWNER },
    }),
  ),
}));

vi.mock("@billow/auth", () => ({ auth: { api: authMock } }));

vi.mock("@/lib/workspace/clients", () => ({
  createClientCompany: vi.fn(async () => ({ ok: false, reason: "invalid" })),
  updateClientCompany: vi.fn(async () => ({ ok: false, reason: "not_found" })),
  deleteClientCompany: vi.fn(async () => ({ ok: false, reason: "not_found" })),
  getClientCompany: vi.fn(async () => ({ ok: false, reason: "not_found" })),
  listClientCompanies: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock("@/lib/workspace/invoices", () => ({
  createInvoice: vi.fn(async () => ({ ok: false, reason: "invalid" })),
  updateInvoice: vi.fn(async () => ({ ok: false, reason: "not_found" })),
  deleteInvoice: vi.fn(async () => ({ ok: false, reason: "not_found" })),
  getInvoice: vi.fn(async () => ({ ok: false, reason: "not_found" })),
  listInvoices: vi.fn(async () => ({
    ok: true,
    data: { invoices: [], count: 0, truncated: false },
  })),
}));

vi.mock("@/lib/workspace/tax-periods", () => ({
  createTaxPeriod: vi.fn(async () => ({ ok: false, reason: "invalid" })),
  updateTaxPeriod: vi.fn(async () => ({ ok: false, reason: "not_found" })),
  deleteTaxPeriod: vi.fn(async () => ({ ok: false, reason: "not_found" })),
  getTaxPeriod: vi.fn(async () => ({ ok: false, reason: "not_found" })),
  listTaxPeriods: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock("@/lib/uploads", () => ({
  UploadRejectedError: class extends Error {
    status = 400;
  },
  createUpload: vi.fn(),
  listUploads: vi.fn(),
  deleteUpload: vi.fn(async () => false),
}));

const ORIGIN = "http://umbrel.local:3000";

function post(path: string, headers: Record<string, string>) {
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers });
}

function del(path: string, headers: Record<string, string>) {
  return new Request(`${ORIGIN}${path}`, { method: "DELETE", headers });
}

function put(path: string, headers: Record<string, string>) {
  return new Request(`${ORIGIN}${path}`, { method: "PUT", headers });
}

/** requireApiIdentity takes the Request now, so the guard lives with it. */
function get(headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/v1/me`, { headers });
}

const clientParams = { params: Promise.resolve({ id: "1" }) };

const apiKeyHeaders = { authorization: `Bearer ${API_KEY}` };
// `Basic` is not a credential requireApiIdentity accepts, so a request sending
// it authenticates by cookie — the exact case a presence-only check on the
// `authorization` header used to wave past the origin guard.
const basicHeaders = { authorization: "Basic YWRtaW46aHVudGVyMg==" };
const sameOriginHeaders = { origin: ORIGIN, host: "umbrel.local:3000" };

describe("requireApiIdentity", () => {
  it("reports an x-api-key caller as authenticated by API key", async () => {
    const identity = await requireApiIdentity(get({ "x-api-key": API_KEY }));
    expect(identity).toEqual({ userId: KEY_OWNER, via: "apiKey" });
  });

  it("reports an Authorization: Bearer caller as authenticated by API key", async () => {
    const identity = await requireApiIdentity(get(apiKeyHeaders));
    expect(identity).toEqual({ userId: KEY_OWNER, via: "apiKey" });
  });

  it("reports an Authorization scheme it does not accept as a session caller", async () => {
    const identity = await requireApiIdentity(get(basicHeaders));
    expect(identity).toEqual({ userId: SESSION_OWNER, via: "session" });
  });

  it("reports a plain cookie caller as a session caller", async () => {
    const identity = await requireApiIdentity(get());
    expect(identity).toEqual({ userId: SESSION_OWNER, via: "session" });
  });
});

/**
 * Scopes. The route says `mutating`, and that one flag decides both the CSRF
 * guard and which grant the key needs.
 */
describe("API key scopes", () => {
  function readOnlyKey() {
    authMock.verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { referenceId: KEY_OWNER, permissions: { billow: ["read"] } },
    });
  }

  it("lets a read-only key read", async () => {
    readOnlyKey();
    await expect(
      requireApiIdentity(get({ "x-api-key": API_KEY })),
    ).resolves.toEqual({ userId: KEY_OWNER, via: "apiKey" });
  });

  it("refuses a write from a read-only key with 403, not 401", async () => {
    // 401 would say the credential is bad and send the caller off to reissue a
    // key that was never the problem — the same misdiagnosis the rate limiter
    // used to hand out.
    readOnlyKey();
    const result = (await requireApiIdentity(get({ "x-api-key": API_KEY }), {
      mutating: true,
    })) as Response;

    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toMatchObject({
      error: expect.stringContaining("read-only"),
    });
  });

  it("lets a read_write key write", async () => {
    await expect(
      requireApiIdentity(get({ "x-api-key": API_KEY }), { mutating: true }),
    ).resolves.toEqual({ userId: KEY_OWNER, via: "apiKey" });
  });

  it("never scope-checks a session: the signed-in user is the owner", async () => {
    await expect(
      requireApiIdentity(
        new Request(`${ORIGIN}/api/v1/clients`, {
          method: "POST",
          headers: sameOriginHeaders,
        }),
        { mutating: true },
      ),
    ).resolves.toEqual({ userId: SESSION_OWNER, via: "session" });
  });

  it("treats a key with no permissions as read-only rather than invalid", async () => {
    // authClient.apiKey.create sets none, and it is reachable from a browser
    // console. Least privilege, not lockout.
    authMock.verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { referenceId: KEY_OWNER, permissions: null },
    });
    const result = (await requireApiIdentity(get({ "x-api-key": API_KEY }), {
      mutating: true,
    })) as Response;
    expect(result.status).toBe(403);
  });
});

/**
 * The guard itself, now that it lives in one place rather than in seven route
 * files. The route tests below prove each route opts in; these prove what
 * opting in does.
 */
describe("the mutation origin guard", () => {
  function mutation(headers: Record<string, string>) {
    return new Request(`${ORIGIN}/api/v1/clients`, { method: "POST", headers });
  }

  it("refuses a cookie caller that sent no origin", async () => {
    const result = (await requireApiIdentity(mutation({}), {
      mutating: true,
    })) as Response;
    expect(result.status).toBe(403);
  });

  it("allows a cookie caller from this app", async () => {
    const result = await requireApiIdentity(mutation(sameOriginHeaders), {
      mutating: true,
    });
    expect(result).toEqual({ userId: SESSION_OWNER, via: "session" });
  });

  it("never applies to an API key, which no page can forge", async () => {
    const result = await requireApiIdentity(mutation(apiKeyHeaders), {
      mutating: true,
    });
    expect(result).toEqual({ userId: KEY_OWNER, via: "apiKey" });
  });

  it("is off unless asked for: a read needs no guard", async () => {
    // Browsers send no Origin on a same-origin GET, so guarding reads would
    // 403 the app's own pages. That is a real regression this repo has had.
    const result = await requireApiIdentity(mutation({}));
    expect(result).toEqual({ userId: SESSION_OWNER, via: "session" });
  });

  it("answers 401 before 403 when nothing authenticated at all", async () => {
    // Ordering matters: telling an anonymous caller they are "forbidden" sends
    // them looking for a permission problem when they simply need to sign in.
    authMock.getSession.mockResolvedValueOnce(null);
    const result = (await requireApiIdentity(mutation({}), {
      mutating: true,
    })) as Response;
    expect(result.status).toBe(401);
  });
});

/**
 * The property under test is that the origin check is skipped for exactly the
 * requests that really did authenticate by API key. Exercising the route
 * handlers rather than the helper is deliberate: the bug being fixed lived in
 * the composition, not in either half on its own.
 *
 * A non-403 answer means the guard let the request through; what the route
 * does afterwards (400 for a missing body, 404 for a missing row) is
 * incidental here.
 */
describe("same-origin guard on API-key-capable routes", () => {
  it("POST /api/v1/uploads skips the origin check for a Bearer API key", async () => {
    const { POST } = await import("@/app/api/v1/uploads/route");
    const response = await POST(post("/api/v1/uploads", apiKeyHeaders));
    expect(response.status).not.toBe(403);
  });

  it("POST /api/v1/uploads rejects a Basic header riding on a session cookie", async () => {
    const { POST } = await import("@/app/api/v1/uploads/route");
    const response = await POST(post("/api/v1/uploads", basicHeaders));
    expect(response.status).toBe(403);
  });

  it("POST /api/v1/uploads rejects a session request with no origin", async () => {
    const { POST } = await import("@/app/api/v1/uploads/route");
    const response = await POST(post("/api/v1/uploads", {}));
    expect(response.status).toBe(403);
  });

  it("POST /api/v1/uploads allows a session request from this app", async () => {
    const { POST } = await import("@/app/api/v1/uploads/route");
    const response = await POST(post("/api/v1/uploads", sameOriginHeaders));
    expect(response.status).not.toBe(403);
  });

  it("DELETE /api/v1/uploads/[id] skips the origin check for a Bearer API key", async () => {
    const { DELETE } = await import("@/app/api/v1/uploads/[id]/route");
    const response = await DELETE(del("/api/v1/uploads/abc", apiKeyHeaders), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(response.status).not.toBe(403);
  });

  it("DELETE /api/v1/uploads/[id] rejects a Basic header riding on a session cookie", async () => {
    const { DELETE } = await import("@/app/api/v1/uploads/[id]/route");
    const response = await DELETE(del("/api/v1/uploads/abc", basicHeaders), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(response.status).toBe(403);
  });

  it("DELETE /api/v1/uploads/[id] rejects a session request with no origin", async () => {
    const { DELETE } = await import("@/app/api/v1/uploads/[id]/route");
    const response = await DELETE(del("/api/v1/uploads/abc", {}), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(response.status).toBe(403);
  });

  it("POST /api/v1/clients skips the origin check for a Bearer API key", async () => {
    const { POST } = await import("@/app/api/v1/clients/route");
    const response = await POST(post("/api/v1/clients", apiKeyHeaders));
    expect(response.status).not.toBe(403);
  });

  it("POST /api/v1/clients rejects a Basic header riding on a session cookie", async () => {
    const { POST } = await import("@/app/api/v1/clients/route");
    const response = await POST(post("/api/v1/clients", basicHeaders));
    expect(response.status).toBe(403);
  });

  it("POST /api/v1/clients rejects a session request with no origin", async () => {
    const { POST } = await import("@/app/api/v1/clients/route");
    const response = await POST(post("/api/v1/clients", {}));
    expect(response.status).toBe(403);
  });

  it("PUT /api/v1/clients/[id] rejects a session request with no origin", async () => {
    const { PUT } = await import("@/app/api/v1/clients/[id]/route");
    const response = await PUT(put("/api/v1/clients/1", {}), clientParams);
    expect(response.status).toBe(403);
  });

  it("PUT /api/v1/clients/[id] skips the origin check for a Bearer API key", async () => {
    const { PUT } = await import("@/app/api/v1/clients/[id]/route");
    const response = await PUT(
      put("/api/v1/clients/1", apiKeyHeaders),
      clientParams,
    );
    expect(response.status).not.toBe(403);
  });

  it("DELETE /api/v1/clients/[id] rejects a session request with no origin", async () => {
    const { DELETE } = await import("@/app/api/v1/clients/[id]/route");
    const response = await DELETE(del("/api/v1/clients/1", {}), clientParams);
    expect(response.status).toBe(403);
  });

  it("DELETE /api/v1/clients/[id] skips the origin check for a Bearer API key", async () => {
    const { DELETE } = await import("@/app/api/v1/clients/[id]/route");
    const response = await DELETE(
      del("/api/v1/clients/1", apiKeyHeaders),
      clientParams,
    );
    expect(response.status).not.toBe(403);
  });

  it("GET /api/v1/clients stays exempt: browsers send no origin on a same-origin GET", async () => {
    const { GET } = await import("@/app/api/v1/clients/route");
    const response = await GET(new Request(`${ORIGIN}/api/v1/clients`));
    expect(response.status).toBe(200);
  });

  it("POST /api/v1/tax-periods skips the origin check for a Bearer API key", async () => {
    const { POST } = await import("@/app/api/v1/tax-periods/route");
    const response = await POST(post("/api/v1/tax-periods", apiKeyHeaders));
    expect(response.status).not.toBe(403);
  });

  it("POST /api/v1/tax-periods rejects a session request with no origin", async () => {
    const { POST } = await import("@/app/api/v1/tax-periods/route");
    const response = await POST(post("/api/v1/tax-periods", {}));
    expect(response.status).toBe(403);
  });

  it("POST /api/v1/tax-periods rejects a Basic header riding on a session cookie", async () => {
    const { POST } = await import("@/app/api/v1/tax-periods/route");
    const response = await POST(post("/api/v1/tax-periods", basicHeaders));
    expect(response.status).toBe(403);
  });

  it("PUT /api/v1/tax-periods/[id] rejects a session request with no origin", async () => {
    const { PUT } = await import("@/app/api/v1/tax-periods/[id]/route");
    const response = await PUT(put("/api/v1/tax-periods/1", {}), clientParams);
    expect(response.status).toBe(403);
  });

  it("PUT /api/v1/tax-periods/[id] skips the origin check for a Bearer API key", async () => {
    const { PUT } = await import("@/app/api/v1/tax-periods/[id]/route");
    const response = await PUT(
      put("/api/v1/tax-periods/1", apiKeyHeaders),
      clientParams,
    );
    expect(response.status).not.toBe(403);
  });

  it("DELETE /api/v1/tax-periods/[id] rejects a session request with no origin", async () => {
    const { DELETE } = await import("@/app/api/v1/tax-periods/[id]/route");
    const response = await DELETE(
      del("/api/v1/tax-periods/1", {}),
      clientParams,
    );
    expect(response.status).toBe(403);
  });

  it("DELETE /api/v1/tax-periods/[id] skips the origin check for a Bearer API key", async () => {
    const { DELETE } = await import("@/app/api/v1/tax-periods/[id]/route");
    const response = await DELETE(
      del("/api/v1/tax-periods/1", apiKeyHeaders),
      clientParams,
    );
    expect(response.status).not.toBe(403);
  });

  it("GET /api/v1/tax-periods stays exempt: browsers send no origin on a same-origin GET", async () => {
    const { GET } = await import("@/app/api/v1/tax-periods/route");
    const response = await GET(new Request(`${ORIGIN}/api/v1/tax-periods`));
    expect(response.status).toBe(200);
  });

  it("POST /api/v1/invoices skips the origin check for a Bearer API key", async () => {
    const { POST } = await import("@/app/api/v1/invoices/route");
    const response = await POST(post("/api/v1/invoices", apiKeyHeaders));
    expect(response.status).not.toBe(403);
  });

  it("POST /api/v1/invoices rejects a session request with no origin", async () => {
    const { POST } = await import("@/app/api/v1/invoices/route");
    const response = await POST(post("/api/v1/invoices", {}));
    expect(response.status).toBe(403);
  });

  it("PUT /api/v1/invoices/[id] rejects a session request with no origin", async () => {
    const { PUT } = await import("@/app/api/v1/invoices/[id]/route");
    const response = await PUT(put("/api/v1/invoices/x", {}), clientParams);
    expect(response.status).toBe(403);
  });

  it("DELETE /api/v1/invoices/[id] rejects a session request with no origin", async () => {
    const { DELETE } = await import("@/app/api/v1/invoices/[id]/route");
    const response = await DELETE(del("/api/v1/invoices/x", {}), clientParams);
    expect(response.status).toBe(403);
  });

  it("DELETE /api/v1/invoices/[id] is refused for a read-only key", async () => {
    // The verb scoped keys existed for: line items and the revision history
    // cascade, and no rule can make that reversible.
    authMock.verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { referenceId: KEY_OWNER, permissions: { billow: ["read"] } },
    });
    const { DELETE } = await import("@/app/api/v1/invoices/[id]/route");
    const response = await DELETE(
      del("/api/v1/invoices/x", apiKeyHeaders),
      clientParams,
    );
    expect(response.status).toBe(403);
  });

  it("GET /api/v1/invoices allows a read-only key", async () => {
    authMock.verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { referenceId: KEY_OWNER, permissions: { billow: ["read"] } },
    });
    const { GET } = await import("@/app/api/v1/invoices/route");
    const response = await GET(
      new Request(`${ORIGIN}/api/v1/invoices`, { headers: apiKeyHeaders }),
    );
    expect(response.status).toBe(200);
  });

  it("POST /api/v1/vault skips the origin check for a Bearer API key", async () => {
    const { POST } = await import("@/app/api/v1/vault/route");
    const response = await POST(post("/api/v1/vault", apiKeyHeaders));
    expect(response.status).not.toBe(403);
  });

  it("POST /api/v1/vault rejects a Basic header riding on a session cookie", async () => {
    const { POST } = await import("@/app/api/v1/vault/route");
    const response = await POST(post("/api/v1/vault", basicHeaders));
    expect(response.status).toBe(403);
  });

  it("POST /api/v1/vault rejects a session request with no origin", async () => {
    const { POST } = await import("@/app/api/v1/vault/route");
    const response = await POST(post("/api/v1/vault", {}));
    expect(response.status).toBe(403);
  });

  it("POST /api/v1/vault allows a session request from this app", async () => {
    const { POST } = await import("@/app/api/v1/vault/route");
    const response = await POST(post("/api/v1/vault", sameOriginHeaders));
    expect(response.status).not.toBe(403);
  });

  it("GET /api/v1/vault stays exempt: browsers send no origin on a same-origin GET", async () => {
    const { GET } = await import("@/app/api/v1/vault/route");
    const response = await GET(new Request(`${ORIGIN}/api/v1/vault`));
    // 401 for the missing vault key, not 403 for the missing origin.
    expect(response.status).toBe(401);
  });
});

/**
 * A throttled key is a working credential being told to wait. Answering 401
 * makes a client treat it as invalid — the failure this covers is a caller
 * that discarded a good key, and one that retried flat out because nothing in
 * the response said how long to wait.
 */
describe("rate-limited API keys", () => {
  const rateLimitedResult = {
    valid: false,
    key: null,
    error: {
      message: "Rate limit exceeded",
      code: "RATE_LIMITED",
      details: { tryAgainIn: 42_000 },
    },
  };

  it("answers 429 with Retry-After, not 401", async () => {
    authMock.verifyApiKey.mockResolvedValueOnce(rateLimitedResult);

    const response = await requireApiIdentity(get({ "x-api-key": API_KEY }));

    expect(response).toBeInstanceOf(Response);
    const result = response as Response;
    expect(result.status).toBe(429);
    expect(result.headers.get("Retry-After")).toBe("42");
    await expect(result.json()).resolves.toMatchObject({ retryAfter: 42 });
  });

  it("still says wait when the plugin gives no window", async () => {
    authMock.verifyApiKey.mockResolvedValueOnce({
      ...rateLimitedResult,
      error: { message: "Rate limit exceeded", code: "RATE_LIMITED" },
    });

    const result = (await requireApiIdentity(
      get({ "x-api-key": API_KEY }),
    )) as Response;

    expect(result.status).toBe(429);
    expect(result.headers.get("Retry-After")).toBe("1");
  });

  it("leaves a genuinely invalid key at 401", async () => {
    const result = (await requireApiIdentity(
      get({ "x-api-key": "not-the-key" }),
    )) as Response;

    expect(result.status).toBe(401);
    expect(result.headers.get("Retry-After")).toBeNull();
  });
});
