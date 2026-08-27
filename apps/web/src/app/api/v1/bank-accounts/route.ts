import { NextResponse } from "next/server";

import { requireApiIdentity } from "@/lib/api/identity";
import { workspaceError } from "@/lib/api/workspace-route";
import { listBankAccounts } from "@/lib/workspace/references";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/bank-accounts
 *
 * The accounts invoices can be paid into, as `bankAccountId` values to pick
 * between — a label and a bank name, never the account itself. Every
 * identifying field (number, IBAN, CLABE, SWIFT, holder) is sealed under the
 * owner's data key and would come back null for an API key.
 */
export async function GET(request: Request) {
  const identity = await requireApiIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const result = await listBankAccounts(identity.userId);
  if (!result.ok) return workspaceError(result);

  return NextResponse.json({ bankAccounts: result.data });
}
