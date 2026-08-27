import { z } from "zod";

import {
  accountResponseSchema,
  errorResponseSchema,
} from "@/lib/schemas/api-keys";
import {
  clientListResponseSchema,
  clientResponseSchema,
} from "@/lib/schemas/clients";
import {
  taxPeriodListResponseSchema,
  taxPeriodResponseSchema,
} from "@/lib/schemas/tax-periods";
import {
  uploadListResponseSchema,
  uploadResponseSchema,
} from "@/lib/schemas/uploads";
import { clientCompanySchema, taxPeriodSchema } from "@/lib/schemas/workspace";

const accountSchema = z.toJSONSchema(accountResponseSchema);
const errorSchema = z.toJSONSchema(errorResponseSchema);
const uploadSchema = z.toJSONSchema(uploadResponseSchema);
const uploadListSchema = z.toJSONSchema(uploadListResponseSchema);
const clientSchema = z.toJSONSchema(clientResponseSchema);
const clientListSchema = z.toJSONSchema(clientListResponseSchema);
// The request body is the same schema the "New client" form validates
// against, so the documented shape cannot drift from the enforced one.
const clientInputSchema = z.toJSONSchema(clientCompanySchema, {
  io: "input",
});
const taxPeriodSchemaJson = z.toJSONSchema(taxPeriodResponseSchema);
const taxPeriodListSchema = z.toJSONSchema(taxPeriodListResponseSchema);
const taxPeriodInputSchema = z.toJSONSchema(taxPeriodSchema, { io: "input" });

/**
 * Response and security fragments, shared rather than pasted.
 *
 * Every operation here is authenticated the same way and fails the same ways,
 * so the 401 and 429 entries were byte-identical fifteen times over. Reusing
 * one object means a change to the wording — or a new shared failure mode —
 * lands everywhere at once, and a route cannot quietly document a slightly
 * different 429 than the one it actually returns.
 */
const AUTHENTICATED = [
  { apiKey: [] },
  { bearerAuth: [] },
  { sessionCookie: [] },
];

const jsonError = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});

const UNAUTHORIZED = jsonError("No valid credentials were supplied.");

const FORBIDDEN = jsonError(
  "The API key is read-only, or a cookie-authenticated request did not originate from this app.",
);

const TOO_MANY_REQUESTS = jsonError(
  "The API key's request budget for the current window is spent. Retry-After carries the wait in seconds; the same figure is in the body's retryAfter field.",
);

const INVALID_BODY = jsonError(
  "The body was not a JSON object, or a field failed validation. Field errors are in the fields property.",
);

const INVALID_ID = jsonError("The id was not a positive integer.");

/** The path parameter every serial-id entity shares. */
const ID_PARAMETER = [
  { name: "id", in: "path", required: true, schema: { type: "integer" } },
];

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Billow API",
    version: "v1",
    description: "Personal API for a self-hosted Billow installation.",
  },
  paths: {
    "/api/v1/me": {
      get: {
        operationId: "getCurrentAccount",
        summary: "Get the current account",
        description:
          "Accepts a personal API key in x-api-key or Authorization: Bearer. A signed-in browser session also works.",
        security: AUTHENTICATED,
        responses: {
          "200": {
            description: "The authenticated account.",
            content: { "application/json": { schema: accountSchema } },
          },
          "401": UNAUTHORIZED,
          "404": {
            description: "The authenticated account no longer exists.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
    },
    "/api/v1/clients": {
      get: {
        operationId: "listClients",
        summary: "List client companies",
        description:
          'The authenticated account\'s client companies — the "Bill To" details invoices are issued against — ordered by name.',
        security: AUTHENTICATED,
        responses: {
          "200": {
            description: "The account's client companies.",
            content: { "application/json": { schema: clientListSchema } },
          },
          "401": UNAUTHORIZED,
          "429": TOO_MANY_REQUESTS,
        },
      },
      post: {
        operationId: "createClient",
        summary: "Create a client company",
        description:
          "Creates a client from the same schema the New client form validates against. Responds with the stored row, so the caller holds the server's normalisation and timestamps.",
        security: AUTHENTICATED,
        requestBody: {
          required: true,
          content: { "application/json": { schema: clientInputSchema } },
        },
        responses: {
          "201": {
            description: "The created client company.",
            content: { "application/json": { schema: clientSchema } },
          },
          "400": INVALID_BODY,
          "401": UNAUTHORIZED,
          "403": FORBIDDEN,
          "409": {
            description:
              "The change was refused by a rule: a conflicting record, a row another record still refers to, or a field only a signed-in user can write.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
    },
    "/api/v1/clients/{id}": {
      get: {
        operationId: "getClient",
        summary: "Get one client company",
        description:
          "Looked up scoped to the authenticated account. An id belonging to another account 404s exactly like a missing one.",
        security: AUTHENTICATED,
        parameters: ID_PARAMETER,
        responses: {
          "200": {
            description: "The client company.",
            content: { "application/json": { schema: clientSchema } },
          },
          "400": INVALID_ID,
          "401": UNAUTHORIZED,
          "404": {
            description: "No such client exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
      put: {
        operationId: "replaceClient",
        summary: "Replace a client company",
        description:
          "A full replacement, not a merge: every field the form requires is required here, so an omitted field is invalid rather than left unchanged.",
        security: AUTHENTICATED,
        parameters: ID_PARAMETER,
        requestBody: {
          required: true,
          content: { "application/json": { schema: clientInputSchema } },
        },
        responses: {
          "200": {
            description: "The updated client company.",
            content: { "application/json": { schema: clientSchema } },
          },
          "400": INVALID_BODY,
          "401": UNAUTHORIZED,
          "403": FORBIDDEN,
          "404": {
            description: "No such client exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "409": {
            description:
              "The change was refused by a rule: a conflicting record, a row another record still refers to, or a field only a signed-in user can write.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
      delete: {
        operationId: "deleteClient",
        summary: "Delete a client company",
        description:
          "Refused with 409 while any invoice still refers to this client — invoices keep the billing details they were issued with. Only a client with no invoices can be removed.",
        security: AUTHENTICATED,
        parameters: ID_PARAMETER,
        responses: {
          "200": { description: "The client was deleted." },
          "400": INVALID_ID,
          "401": UNAUTHORIZED,
          "403": FORBIDDEN,
          "404": {
            description: "No such client exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "409": {
            description:
              "The change was refused by a rule: a conflicting record, a row another record still refers to, or a field only a signed-in user can write.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
    },
    "/api/v1/tax-periods": {
      get: {
        operationId: "listTaxPeriods",
        summary: "List monthly tax filings",
        description:
          "The authenticated account's tax periods, most recent month first, each with its attached documents. filedAt and paidAt are calendar days (YYYY-MM-DD), not timestamps.",
        security: AUTHENTICATED,
        responses: {
          "200": {
            description: "The account's tax periods.",
            content: { "application/json": { schema: taxPeriodListSchema } },
          },
          "401": UNAUTHORIZED,
          "429": TOO_MANY_REQUESTS,
        },
      },
      post: {
        operationId: "createTaxPeriod",
        summary: "Create a monthly tax filing",
        description:
          "Creates the filing record for one month. A month that already has one answers 409 rather than overwriting it.",
        security: AUTHENTICATED,
        requestBody: {
          required: true,
          content: { "application/json": { schema: taxPeriodInputSchema } },
        },
        responses: {
          "201": {
            description: "The created tax period.",
            content: { "application/json": { schema: taxPeriodSchemaJson } },
          },
          "400": INVALID_BODY,
          "401": UNAUTHORIZED,
          "403": FORBIDDEN,
          "409": {
            description: "This account already has a period for that month.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
    },
    "/api/v1/tax-periods/{id}": {
      get: {
        operationId: "getTaxPeriod",
        summary: "Get one monthly tax filing",
        description:
          "Scoped to the authenticated account. An id belonging to another account 404s exactly like a missing one.",
        security: AUTHENTICATED,
        parameters: ID_PARAMETER,
        responses: {
          "200": {
            description: "The tax period.",
            content: { "application/json": { schema: taxPeriodSchemaJson } },
          },
          "400": INVALID_ID,
          "401": UNAUTHORIZED,
          "404": {
            description: "No such tax period exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
      put: {
        operationId: "replaceTaxPeriod",
        summary: "Replace a monthly tax filing",
        description:
          "A full replacement: an omitted nullable field is written as null, so leaving out paidAt clears the payment date. Attached documents are not part of this representation and are untouched.",
        security: AUTHENTICATED,
        parameters: ID_PARAMETER,
        requestBody: {
          required: true,
          content: { "application/json": { schema: taxPeriodInputSchema } },
        },
        responses: {
          "200": {
            description: "The updated tax period.",
            content: { "application/json": { schema: taxPeriodSchemaJson } },
          },
          "400": INVALID_BODY,
          "401": UNAUTHORIZED,
          "403": FORBIDDEN,
          "404": {
            description: "No such tax period exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "409": {
            description: "Another period already covers the target month.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
      delete: {
        operationId: "deleteTaxPeriod",
        summary: "Delete a monthly tax filing",
        description:
          "Refused with 409 while any document is attached. The filed return and payment confirmation are detached through the invoice workflow, never by cascading them away with the period.",
        security: AUTHENTICATED,
        parameters: ID_PARAMETER,
        responses: {
          "200": { description: "The tax period was deleted." },
          "400": INVALID_ID,
          "401": UNAUTHORIZED,
          "403": FORBIDDEN,
          "404": {
            description: "No such tax period exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "409": {
            description: "A document is still attached to this period.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
    },
    "/api/v1/uploads": {
      post: {
        operationId: "createUpload",
        summary: "Upload a file",
        description:
          "Stores a file (PNG, JPEG, GIF, WEBP or PDF) for the authenticated account. The file's type is detected from its bytes, never trusted from the request's declared Content-Type.",
        security: AUTHENTICATED,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary" },
                },
                required: ["file"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "The stored file's metadata.",
            content: { "application/json": { schema: uploadSchema } },
          },
          "400": {
            description: "The request was not a valid multipart upload.",
            content: { "application/json": { schema: errorSchema } },
          },
          "401": UNAUTHORIZED,
          "403": FORBIDDEN,
          "409": {
            description: "The account's storage quota would be exceeded.",
            content: { "application/json": { schema: errorSchema } },
          },
          "413": {
            description: "The file exceeds the maximum upload size.",
            content: { "application/json": { schema: errorSchema } },
          },
          "415": {
            description: "The file's bytes did not match any accepted type.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
      get: {
        operationId: "listUploads",
        summary: "List uploaded files",
        description:
          "Lists the authenticated account's files and current storage usage. Only attachments are returned unless kind says otherwise; usage.bytes always covers every kind, and usage.byKind explains the difference.",
        security: AUTHENTICATED,
        parameters: [
          {
            name: "kind",
            in: "query",
            required: false,
            description:
              "Which files to return. Defaults to attachment. Use all to include the documents the invoice workflow has adopted, which count against the quota but are managed from the invoice UI.",
            schema: {
              type: "string",
              enum: [
                "attachment",
                "invoice_document",
                "tax_period_document",
                "all",
              ],
              default: "attachment",
            },
          },
        ],
        responses: {
          "200": {
            description: "The account's files and storage usage.",
            content: { "application/json": { schema: uploadListSchema } },
          },
          "400": {
            description: "The kind parameter was not a recognized value.",
            content: { "application/json": { schema: errorSchema } },
          },
          "401": UNAUTHORIZED,
          "429": TOO_MANY_REQUESTS,
        },
      },
    },
    "/api/v1/uploads/{id}": {
      get: {
        operationId: "downloadUpload",
        summary: "Download a file",
        description:
          "Streams back a previously uploaded file's bytes, scoped to the authenticated account. An id that belongs to another account 404s exactly like a missing one.",
        security: AUTHENTICATED,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description:
              "The file's raw bytes, with the detected content type.",
          },
          "401": UNAUTHORIZED,
          "404": {
            description: "No such file exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
      delete: {
        operationId: "deleteUpload",
        summary: "Delete a file",
        description:
          "Deletes a previously uploaded file, scoped to the authenticated account.",
        security: AUTHENTICATED,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "The file was deleted.",
          },
          "401": UNAUTHORIZED,
          "403": FORBIDDEN,
          "404": {
            description: "No such file exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": TOO_MANY_REQUESTS,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description:
          "Personal API key created in Settings. Keys are read-only by default; a write needs a read-and-write key, and a read-only key gets 403 rather than 401.",
      },
      bearerAuth: { type: "http", scheme: "bearer" },
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
        description: "Authenticated browser session.",
      },
    },
  },
} as const;
