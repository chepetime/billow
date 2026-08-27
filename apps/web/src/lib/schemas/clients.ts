import { z } from "zod";

/**
 * Shape returned for a client company. Also feeds the OpenAPI document.
 *
 * Written out field by field rather than derived from the Prisma model so
 * that adding a column to `ClientCompany` does not silently widen the API.
 * `userId` is deliberately absent: the caller is the owner by construction.
 */
export const clientResponseSchema = z.object({
  id: z.number().int().meta({ description: "Stable client identifier." }),
  name: z.string().meta({ description: "Company name, as billed." }),
  legalName: z
    .string()
    .nullable()
    .meta({ description: "Registered legal name, or null when unset." }),
  address1: z.string().meta({ description: "Street address." }),
  address2: z
    .string()
    .nullable()
    .meta({ description: "Second address line, or null." }),
  cityStatePostal: z
    .string()
    .meta({ description: "City, state and postal code, as one line." }),
  country: z.string().meta({ description: "Country." }),
  email: z.string().meta({ description: "Billing contact email address." }),
  attentionTo: z
    .string()
    .nullable()
    .meta({ description: 'The "Attn:" line, or null when unset.' }),
  notes: z
    .string()
    .nullable()
    .meta({ description: "Free-form notes, or null." }),
  createdAt: z
    .string()
    .meta({ description: "When the client was added, as an ISO timestamp." }),
  updatedAt: z
    .string()
    .meta({ description: "When it last changed, as an ISO timestamp." }),
});

export const clientListResponseSchema = z.object({
  clients: z.array(clientResponseSchema),
});

export type ClientResponse = z.infer<typeof clientResponseSchema>;

/** Row to response. The single place the API's client shape is decided. */
export function toClientResponse(client: {
  id: number;
  name: string;
  legalName: string | null;
  address1: string;
  address2: string | null;
  cityStatePostal: string;
  country: string;
  email: string;
  attentionTo: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ClientResponse {
  return {
    id: client.id,
    name: client.name,
    legalName: client.legalName,
    address1: client.address1,
    address2: client.address2,
    cityStatePostal: client.cityStatePostal,
    country: client.country,
    email: client.email,
    attentionTo: client.attentionTo,
    notes: client.notes,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}
