import { z } from "zod";

import { accountResponseSchema, errorResponseSchema } from "@/lib/schemas/api-keys";
import { uploadListResponseSchema, uploadResponseSchema } from "@/lib/schemas/uploads";

const accountSchema = z.toJSONSchema(accountResponseSchema);
const errorSchema = z.toJSONSchema(errorResponseSchema);
const uploadSchema = z.toJSONSchema(uploadResponseSchema);
const uploadListSchema = z.toJSONSchema(uploadListResponseSchema);

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
            description: "A cookie-authenticated request did not originate from this app.",
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
        },
      },
      get: {
        operationId: "listUploads",
        summary: "List uploaded files",
        description: "Lists the authenticated account's files and current storage usage.",
        security: [{ apiKey: [] }, { bearerAuth: [] }, { sessionCookie: [] }],
        responses: {
          "200": {
            description: "The account's files and storage usage.",
            content: { "application/json": { schema: uploadListSchema } },
          },
          "401": {
            description: "No valid credentials were supplied.",
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
            description: "The file's raw bytes, with the detected content type.",
          },
          "401": {
            description: "No valid credentials were supplied.",
            content: { "application/json": { schema: errorSchema } },
          },
          "404": {
            description: "No such file exists for this account.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
      delete: {
        operationId: "deleteUpload",
        summary: "Delete a file",
        description: "Deletes a previously uploaded file, scoped to the authenticated account.",
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
            description: "A cookie-authenticated request did not originate from this app.",
            content: { "application/json": { schema: errorSchema } },
          },
          "404": {
            description: "No such file exists for this account.",
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
