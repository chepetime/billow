import { z } from "zod";

import { accountResponseSchema, errorResponseSchema } from "@/lib/schemas/api-keys";

const accountSchema = z.toJSONSchema(accountResponseSchema);
const errorSchema = z.toJSONSchema(errorResponseSchema);

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
