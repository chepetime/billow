import { describe, expect, it, vi } from "vitest";

import { requireApiIdentity } from "@/lib/api/identity";

const API_KEY = "billow_test_key";
const KEY_OWNER = "user-from-api-key";
const SESSION_OWNER = "user-from-session";

const authMock = vi.hoisted(() => ({
  verifyApiKey: vi.fn(async ({ body }: { body: { key: string } }) =>
    body.key === API_KEY
      ? { valid: true, key: { referenceId: KEY_OWNER } }
      : { valid: false, key: null, error: { message: "Invalid API key." } },
  ),
  // Every request in this file is treated as carrying a valid session cookie,
  // which is the situation the guard has to get right: an attacker's forged
  // request rides on a real session.
  getSession: vi.fn(async () => ({ user: { id: SESSION_OWNER } })),
}));

vi.mock("@billow/auth", () => ({ auth: { api: authMock } }));

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

const apiKeyHeaders = { authorization: `Bearer ${API_KEY}` };
// `Basic` is not a credential requireApiIdentity accepts, so a request sending
// it authenticates by cookie — the exact case a presence-only check on the
// `authorization` header used to wave past the origin guard.
const basicHeaders = { authorization: "Basic YWRtaW46aHVudGVyMg==" };
const sameOriginHeaders = { origin: ORIGIN, host: "umbrel.local:3000" };

describe("requireApiIdentity", () => {
  it("reports an x-api-key caller as authenticated by API key", async () => {
    const identity = await requireApiIdentity(
      new Headers({ "x-api-key": API_KEY }),
    );
    expect(identity).toEqual({ userId: KEY_OWNER, via: "apiKey" });
  });

  it("reports an Authorization: Bearer caller as authenticated by API key", async () => {
    const identity = await requireApiIdentity(new Headers(apiKeyHeaders));
    expect(identity).toEqual({ userId: KEY_OWNER, via: "apiKey" });
  });

  it("reports an Authorization scheme it does not accept as a session caller", async () => {
    const identity = await requireApiIdentity(new Headers(basicHeaders));
    expect(identity).toEqual({ userId: SESSION_OWNER, via: "session" });
  });

  it("reports a plain cookie caller as a session caller", async () => {
    const identity = await requireApiIdentity(new Headers());
    expect(identity).toEqual({ userId: SESSION_OWNER, via: "session" });
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
