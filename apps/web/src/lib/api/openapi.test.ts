import { describe, expect, it } from "vitest";

import { openApiDocument } from "@/lib/api/openapi";

type Operation = {
  operationId?: string;
  security?: unknown[];
  responses?: Record<string, unknown>;
  requestBody?: unknown;
};

const METHODS = ["get", "post", "put", "delete"] as const;

function operations(): Array<[string, string, Operation]> {
  const found: Array<[string, string, Operation]> = [];
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    for (const method of METHODS) {
      const operation = (
        item as unknown as Record<string, Operation | undefined>
      )[method];
      if (operation) found.push([path, method, operation]);
    }
  }
  return found;
}

/**
 * The document is hand-written, so nothing but a test stops a new route from
 * being published without the parts a generated client needs. These are the
 * properties that break a consumer rather than merely read badly.
 */
describe("openApiDocument", () => {
  it("serializes to JSON — it is served verbatim from /api/v1/openapi.json", () => {
    expect(() => JSON.stringify(openApiDocument)).not.toThrow();
  });

  it("gives every operation a unique operationId", () => {
    const ids = operations().map(([, , operation]) => operation.operationId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(operations())(
    "%s %s documents auth and its failures",
    (_p, _m, op) => {
      expect(op.security).toBeDefined();
      expect(op.responses?.["401"]).toBeDefined();
      // Every authenticated route runs through requireApiIdentity, so every one
      // of them can answer 429. A client generated without it treats a throttle
      // as an unmodelled error.
      expect(op.responses?.["429"]).toBeDefined();
    },
  );

  it("documents a request body for each verb that reads one", () => {
    for (const [path, method, operation] of operations()) {
      const writesBody = method === "post" || method === "put";
      const isUploadDelete = path.includes("uploads") && method === "delete";
      if (!writesBody || isUploadDelete) continue;
      expect(operation.requestBody, `${method} ${path}`).toBeDefined();
    }
  });

  it("exposes the full client-company surface", () => {
    expect(Object.keys(openApiDocument.paths["/api/v1/clients"])).toEqual(
      expect.arrayContaining(["get", "post"]),
    );
    expect(Object.keys(openApiDocument.paths["/api/v1/clients/{id}"])).toEqual(
      expect.arrayContaining(["get", "put", "delete"]),
    );
  });

  it("exposes the full tax-period surface", () => {
    expect(Object.keys(openApiDocument.paths["/api/v1/tax-periods"])).toEqual(
      expect.arrayContaining(["get", "post"]),
    );
    expect(
      Object.keys(openApiDocument.paths["/api/v1/tax-periods/{id}"]),
    ).toEqual(expect.arrayContaining(["get", "put", "delete"]));
  });

  it("exposes the full invoice surface", () => {
    expect(Object.keys(openApiDocument.paths["/api/v1/invoices"])).toEqual(
      expect.arrayContaining(["get", "post"]),
    );
    expect(Object.keys(openApiDocument.paths["/api/v1/invoices/{id}"])).toEqual(
      expect.arrayContaining(["get", "put", "delete"]),
    );
  });

  it("documents the invoice id as a uuid, not an integer", () => {
    // Invoices are keyed by publicId. A generated client typing this as an
    // integer would be unable to address a single invoice.
    const parameters = (
      openApiDocument.paths["/api/v1/invoices/{id}"].get as {
        parameters: Array<{ name: string; schema: { type: string } }>;
      }
    ).parameters;
    expect(parameters[0]).toMatchObject({
      name: "id",
      schema: { type: "string", format: "uuid" },
    });
  });

  it("documents 409 on every tax-period write", () => {
    // Duplicate month, and a delete refused while documents are attached.
    const writes = operations().filter(
      ([path, method]) =>
        path.startsWith("/api/v1/tax-periods") && method !== "get",
    );
    expect(writes).toHaveLength(3);
    for (const [path, method, operation] of writes) {
      expect(operation.responses?.["409"], `${method} ${path}`).toBeDefined();
    }
  });

  it("documents 409 on every client write", () => {
    // in_use, conflict and no_key all land on 409. A client that does not model
    // it retries a delete the database will refuse every time.
    const writes = operations().filter(
      ([path, method]) =>
        path.startsWith("/api/v1/clients") && method !== "get",
    );
    expect(writes).toHaveLength(3);
    for (const [path, method, operation] of writes) {
      expect(operation.responses?.["409"], `${method} ${path}`).toBeDefined();
    }
  });
});
