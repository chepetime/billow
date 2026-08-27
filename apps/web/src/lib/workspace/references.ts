import "server-only";

import {
  BANK_ACCOUNT_SELECT,
  SENDER_PROFILE_SELECT,
} from "@/lib/schemas/references";
import { rule, succeed, type WorkspaceResult } from "@/lib/workspace/rule";

/**
 * Sender profiles and bank accounts, as the two lists an invoice picks from.
 *
 * Read-only, and deliberately partial. These are the app's two encrypted
 * models: an API-key caller holds no data key, so every sealed column would
 * come back null — a decrypt per column to return nothing, and a response that
 * looks like data loss rather than a design decision. So neither list returns a
 * sealed field at all.
 *
 * That also settles why there are no writes. A create or update touching a
 * sealed column is refused outright for a keyless caller (see
 * `guardedPrisma()` in packages/db), so a write endpoint here would be broken
 * by construction. Managing these stays in the browser, where the key is.
 *
 * The selects live in `lib/schemas/references.ts`, beside the response shapes
 * and where a test can compare them against `ENCRYPTED_FIELDS` without a
 * database. Sealing a column that is exposed there fails that test rather than
 * silently turning the field into nulls here.
 */

export type SenderProfileRow = {
  id: number;
  displayName: string;
  legalName: string;
  email: string;
  department: string | null;
  manager: string | null;
};

export type BankAccountRow = {
  id: number;
  userProfileId: number;
  label: string;
  bankName: string;
  accountType: string | null;
  isDefault: boolean;
};

export async function listSenderProfiles(
  userId: string,
): Promise<WorkspaceResult<SenderProfileRow[]>> {
  return rule("listSenderProfiles", async ({ prisma }) =>
    succeed(
      await prisma.userProfile.findMany({
        where: { userId },
        select: SENDER_PROFILE_SELECT,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ),
  );
}

export async function listBankAccounts(
  userId: string,
): Promise<WorkspaceResult<BankAccountRow[]>> {
  return rule("listBankAccounts", async ({ prisma }) =>
    succeed(
      await prisma.bankAccount.findMany({
        // Scoped through the profile: a bank account has no userId of its own.
        where: { userProfile: { userId } },
        select: BANK_ACCOUNT_SELECT,
        orderBy: [{ isDefault: "desc" }, { label: "asc" }],
      }),
    ),
  );
}
