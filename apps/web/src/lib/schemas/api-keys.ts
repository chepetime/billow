import { z } from "zod";

export const createApiKeySchema = z.object({
  name: z.string().min(1, "Name your key.").max(60),
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
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;
