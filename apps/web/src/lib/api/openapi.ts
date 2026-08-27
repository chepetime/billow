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
  uploadListResponseSchema,
  uploadResponseSchema,
} from "@/lib/schemas/uploads";
import { clientCompanySchema } from "@/lib/schemas/workspace";

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
        security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
        responses: {
          "200": {
            description: "The authenticated account.",
            content: { "application/json": { schema: accountSchema } },
          },
          "401": {
            description: "No valid credentials were supplied.",
            content: { "application/json": { schema: errorSchema } },
          },
          "404": {
            description: "The authenticated account no longer exists.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": {
            description:
              "The API key's request budget for the current window is spent. Retry-After carries the wait in seconds; the same figure is in the body's retryAfter field.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/v1/clients": {
      get: {
        operationId: "listClients",
        summary: "List client companies",
        description:
          'The authenticated account\'s client companies — the "Bill To" details invoices are issued against — ordered by name.',
        security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
        responses: {
          "200": {
            description: "The account's client companies.",
            content: { "application/json": { schema: clientListSchema } },
          },
          "401": {
            description: "No valid credentials were supplied.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": {
            description:
              "The API key's request budget for the current window is spent. Retry-After carries the wait in seconds; the same figure is in the body's retryAfter field.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
      post: {
        operationId: "createClient",
        summary: "Create a client company",
        description:
          "Creates a client from the same schema the New client form validates against. Responds with the stored row, so the caller holds the server's normalisation and timestamps.",
        security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: clientInputSchema } },
        },
        responses: {
          "201": {
            description: "The created client company.",
            content: { "application/json": { schema: clientSchema } },
          },
          "400": {
            description:
              "The body was not a JSON object, or a field failed validation. Field errors are in the fields property.",
            content: { "application/json": { schema: errorSchema } },
          },
          "401": {
            description: "No valid credentials were supplied.",
            content: { "application/json": { schema: errorSchema } },
          },
          "403": {
            description:
              "A cookie-authenticated request did not originate from this app.",
            content: { "application/json": { schema: errorSchema } },
          },
          "409": {
            description:
              "The change was refused by a rule: a conflicting record, a row another record still refers to, or a field only a signed-in user can write.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": {
            description:
              "The API key's request budget for the current window is spent. Retry-After carries the wait in seconds; the same figure is in the body's retryAfter field.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/v1/clients/{id}": {
      get: {
        operationId: "getClient",
        summary: "Get one client company",
        description:
          "Looked up scoped to the authenticated account. An id belonging to another account 404s exactly like a missing one.",
        security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "The client company.",
            content: { "application/json": { schema: clientSchema } },
          },
          "400": {
            description: "The id was not an integer.",
            content: { "application/json": { schema: errorSchema } },
          },
          "401": {
            description: "No valid credentials were supplied.",
            content: { "application/json": { schema: errorSchema } },
          },
          "404": {
            description: "No such client exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": {
            description:
              "The API key's request budget for the current window is spent. Retry-After carries the wait in seconds; the same figure is in the body's retryAfter field.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
      put: {
        operationId: "replaceClient",
        summary: "Replace a client company",
        description:
          "A full replacement, not a merge: every field the form requires is required here, so an omitted field is invalid rather than left unchanged.",
        security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: clientInputSchema } },
        },
        responses: {
          "200": {
            description: "The updated client company.",
            content: { "application/json": { schema: clientSchema } },
          },
          "400": {
            description:
              "The body was not a JSON object, or a field failed validation. Field errors are in the fields property.",
            content: { "application/json": { schema: errorSchema } },
          },
          "401": {
            description: "No valid credentials were supplied.",
            content: { "application/json": { schema: errorSchema } },
          },
          "403": {
            description:
              "A cookie-authenticated request did not originate from this app.",
            content: { "application/json": { schema: errorSchema } },
          },
          "404": {
            description: "No such client exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "409": {
            description:
              "The change was refused by a rule: a conflicting record, a row another record still refers to, or a field only a signed-in user can write.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": {
            description:
              "The API key's request budget for the current window is spent. Retry-After carries the wait in seconds; the same figure is in the body's retryAfter field.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
      delete: {
        operationId: "deleteClient",
        summary: "Delete a client company",
        description:
          "Refused with 409 while any invoice still refers to this client — invoices keep the billing details they were issued with. Only a client with no invoices can be removed.",
        security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": { description: "The client was deleted." },
          "400": {
            description: "The id was not an integer.",
            content: { "application/json": { schema: errorSchema } },
          },
          "401": {
            description: "No valid credentials were supplied.",
            content: { "application/json": { schema: errorSchema } },
          },
          "403": {
            description:
              "A cookie-authenticated request did not originate from this app.",
            content: { "application/json": { schema: errorSchema } },
          },
          "404": {
            description: "No such client exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "409": {
            description:
              "The change was refused by a rule: a conflicting record, a row another record still refers to, or a field only a signed-in user can write.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": {
            description:
              "The API key's request budget for the current window is spent. Retry-After carries the wait in seconds; the same figure is in the body's retryAfter field.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/v1/uploads": {
      post: {
        operationId: "createUpload",
        summary: "Upload a file",
        description:
          "Stores a file (PNG, JPEG, GIF, WEBP or PDF) for the authenticated account. The file's type is detected from its bytes, never trusted from the request's declared Content-Type.",
        security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
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
          "401": {
            description: "No valid credentials were supplied.",
            content: { "application/json": { schema: errorSchema } },
          },
          "403": {
            description:
              "A cookie-authenticated request did not originate from this app.",
            content: { "application/json": { schema: errorSchema } },
          },
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
          "429": {
            description:
              "The API key's request budget for the current window is spent. Retry-After carries the wait in seconds; the same figure is in the body's retryAfter field.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
      get: {
        operationId: "listUploads",
        summary: "List uploaded files",
        description:
          "Lists the authenticated account's files and current storage usage. Only attachments are returned unless kind says otherwise; usage.bytes always covers every kind, and usage.byKind explains the difference.",
        security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
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
          "401": {
            description: "No valid credentials were supplied.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": {
            description:
              "The API key's request budget for the current window is spent. Retry-After carries the wait in seconds; the same figure is in the body's retryAfter field.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/v1/uploads/{id}": {
      get: {
        operationId: "downloadUpload",
        summary: "Download a file",
        description:
          "Streams back a previously uploaded file's bytes, scoped to the authenticated account. An id that belongs to another account 404s exactly like a missing one.",
        security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
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
          "401": {
            description: "No valid credentials were supplied.",
            content: { "application/json": { schema: errorSchema } },
          },
          "404": {
            description: "No such file exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": {
            description:
              "The API key's request budget for the current window is spent. Retry-After carries the wait in seconds; the same figure is in the body's retryAfter field.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
      delete: {
        operationId: "deleteUpload",
        summary: "Delete a file",
        description:
          "Deletes a previously uploaded file, scoped to the authenticated account.",
        security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
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
          "401": {
            description: "No valid credentials were supplied.",
            content: { "application/json": { schema: errorSchema } },
          },
          "403": {
            description:
              "A cookie-authenticated request did not originate from this app.",
            content: { "application/json": { schema: errorSchema } },
          },
          "404": {
            description: "No such file exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": {
            description:
              "The API key's request budget for the current window is spent. Retry-After carries the wait in seconds; the same figure is in the body's retryAfter field.",
            content: { "application/json": { schema: errorSchema } },
          },
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
        description: "Personal API key created in Settings.",
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
