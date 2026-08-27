import { ENCRYPTED_FIELDS } from "@billow/db/field-encryption";
import { z } from "zod";

/**
 * The two reference lists an invoice picks from. Feeds the OpenAPI document.
 *
 * Both are partial views of encrypted models, and the omissions are the point:
 * a tax ID, an address, an account number or a CLABE is sealed under the
 * owner's data key, which an API key cannot reach. Returning those fields would
 * return nulls.
 */
export const senderProfileResponseSchema = z.object({
  id: z
    .number()
    .int()
    .meta({ description: "Use as userProfileId on an invoice." }),
  displayName: z.string().meta({ description: "Short name for the sender." }),
  legalName: z.string().meta({ description: "Registered legal name." }),
  email: z.string().meta({ description: "Sender contact address." }),
  department: z.string().nullable(),
  manager: z.string().nullable(),
});

export const bankAccountResponseSchema = z.object({
  id: z
    .number()
    .int()
    .meta({ description: "Use as bankAccountId on an invoice." }),
  userProfileId: z
    .number()
    .int()
    .meta({ description: "The sender profile this account belongs to." }),
  label: z.string().meta({ description: "What the owner calls this account." }),
  bankName: z.string(),
  accountType: z.string().nullable(),
  isDefault: z.boolean(),
});

export const senderProfileListResponseSchema = z.object({
  senderProfiles: z.array(senderProfileResponseSchema),
});

export const bankAccountListResponseSchema = z.object({
  bankAccounts: z.array(bankAccountResponseSchema),
});

/**
 * The Prisma selects behind the two lists, kept here beside the response
 * schemas rather than in the rules module.
 *
 * Everything listed is plaintext by design, not by omission: the tests assert
 * each field against `ENCRYPTED_FIELDS`, so sealing a column that is exposed
 * here fails them instead of quietly turning the field into nulls for every
 * API-key caller. That check needs no database, which is why these live in a
 * module with no server dependencies.
 */

/** The plaintext identity fields — no `taxId`, no `address`. */
export const SENDER_PROFILE_SELECT = {
  id: true,
  displayName: true,
  legalName: true,
  email: true,
  department: true,
  manager: true,
} as const;

/** Enough to pick an account, with no part of the account itself. */
export const BANK_ACCOUNT_SELECT = {
  id: true,
  userProfileId: true,
  label: true,
  bankName: true,
  accountType: true,
  isDefault: true,
} as const;

export const SENDER_PROFILE_FIELDS = Object.keys(SENDER_PROFILE_SELECT);
export const BANK_ACCOUNT_FIELDS = Object.keys(BANK_ACCOUNT_SELECT);

/** Re-exported so a test can compare the selects against the sealed list. */
export const SEALED_FIELDS = ENCRYPTED_FIELDS;
