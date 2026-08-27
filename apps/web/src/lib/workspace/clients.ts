import "server-only";

import type { ClientCompany } from "@billow/db/client";

import { clientCompanySchema } from "@/lib/schemas/workspace";
import {
  refuse,
  refuseFromError,
  succeed,
  type WorkspaceResult,
} from "@/lib/workspace/result";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

/**
 * Client companies — the "Bill To" block on an invoice.
 *
 * Every rule here takes the owner's `userId` as an argument instead of reading
 * a session. That single change is what lets a server action and an API route
 * share one implementation: the action passes the session's user, the route
 * passes whoever the API key resolved to, and neither can accidentally enforce
 * ownership differently from the other.
 *
 * `getWorkspacePrisma()` still reads the session on its own, but it is
 * answering a different question — "can this request reach a data key?" — and
 * an API-key caller correctly gets the keyless client. Ownership scoping is
 * the `userId` here; encryption is that. Keeping them separate is deliberate.
 *
 * `ClientCompany` holds no encrypted column today, so the keyless client is
 * fully functional for it. That is what makes this entity the right one to
 * split first, and it is exactly what is *not* true of `BankAccount`.
 *
 * The write rules take `unknown` and parse it themselves. Validation is the
 * first invariant, not the caller's homework: a JSON body off the wire and a
 * typed value out of a form both arrive unvalidated as far as the database is
 * concerned, and a route that pre-validated would be a second copy of the
 * schema to drift from.
 */

export async function createClientCompany(
  userId: string,
  input: unknown,
): Promise<WorkspaceResult<{ id: number }>> {
  const parsed = clientCompanySchema.safeParse(input);
  if (!parsed.success) {
    return refuse("invalid", parsed.error.flatten().fieldErrors);
  }

  try {
    const { prisma } = await getWorkspacePrisma();
    const client = await prisma.clientCompany.create({
      data: { ...parsed.data, userId },
      select: { id: true },
    });
    return succeed({ id: client.id });
  } catch (error) {
    return refuseFromError("createClientCompany", error);
  }
}

export async function updateClientCompany(
  userId: string,
  id: number,
  input: unknown,
): Promise<WorkspaceResult> {
  const parsed = clientCompanySchema.safeParse(input);
  if (!parsed.success) {
    return refuse("invalid", parsed.error.flatten().fieldErrors);
  }

  try {
    const { prisma } = await getWorkspacePrisma();
    // `updateMany` with the owner in the filter, rather than a read-then-write:
    // the ownership check and the write are one statement, so there is no
    // window between them and no branch that could update by id alone.
    const { count } = await prisma.clientCompany.updateMany({
      where: { id, userId },
      data: parsed.data,
    });

    return count === 0 ? refuse("not_found") : succeed();
  } catch (error) {
    return refuseFromError("updateClientCompany", error);
  }
}

export async function deleteClientCompany(
  userId: string,
  id: number,
): Promise<WorkspaceResult> {
  try {
    const { prisma } = await getWorkspacePrisma();
    const { count } = await prisma.clientCompany.deleteMany({
      where: { id, userId },
    });

    return count === 0 ? refuse("not_found") : succeed();
  } catch (error) {
    // A client an invoice still points at raises the foreign-key violation
    // that refuseFromError turns into "in_use". Invoices keep the billing
    // details they were issued with, so this refusal is the feature.
    return refuseFromError("deleteClientCompany", error);
  }
}

/**
 * One client, scoped to its owner.
 *
 * Returns the same `not_found` refusal for another owner's id as for one that
 * does not exist, so a caller mapping it to 404 never confirms that some other
 * account's client exists. Reads speak the same vocabulary as the writes above
 * so that one reason-to-status mapper covers the whole entity.
 */
export async function getClientCompany(
  userId: string,
  id: number,
): Promise<WorkspaceResult<ClientCompany>> {
  try {
    const { prisma } = await getWorkspacePrisma();
    const client = await prisma.clientCompany.findFirst({
      where: { id, userId },
    });
    return client === null ? refuse("not_found") : succeed(client);
  } catch (error) {
    return refuseFromError("getClientCompany", error);
  }
}
