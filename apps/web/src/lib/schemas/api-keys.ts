import { z } from "zod";

import { API_KEY_GRANTS } from "@/lib/api/api-key-scope";

export const createApiKeySchema = z.object({
  // A blank label uses the UI's "Personal key" default.
  name: z.string().trim().max(60, "Use at most 60 characters."),
  // Read-only by default. The common case is a script or agent that summarises
  // the workspace, and that one should not be able to delete an invoice.
  grant: z.enum(API_KEY_GRANTS).default("read"),
});

/** Shape returned by GET /api/v1/me. Also feeds the OpenAPI document. */
export const accountResponseSchema = z.object({
  id: z.string().meta({ description: "Stable account identifier." }),
  email: z.email().meta({ description: "Account email address." }),
  name: z.string().meta({ description: "Display name." }),
  username: z
    .string()
    .nullable()
    .meta({ description: "Username, or null when unset." }),
});

export const errorResponseSchema = z.object({
  error: z.string().meta({ description: "Human-readable error message." }),
  retryAfter: z.number().int().positive().optional().meta({
    description:
      "Seconds to wait before retrying. Present only on 429 responses, where it mirrors the Retry-After header.",
  }),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
/** The form's shape before the schema's default fills `grant` in. */
export type CreateApiKeyFormValues = z.input<typeof createApiKeySchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;
