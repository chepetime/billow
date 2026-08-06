"use server";

import { requireSession } from "@billow/auth";
import { revalidatePath } from "next/cache";

import {
  type ActionResult,
  fail,
  ok,
  toActionError,
} from "@/lib/actions/result";
import {
  type ClientCompanyInput,
  clientCompanySchema,
} from "@/lib/schemas/workspace";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

/**
 * Client companies — the "Bill To" block on an invoice.
 *
 * No encrypted column on this model today, but the writes still go through
 * `getWorkspacePrisma()`: one way in is what makes "is this write sealed?"
 * answerable by reading the file, and a mixed convention is exactly what
 * shipped plaintext account numbers once already.
 */

function revalidate() {
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

export async function createClientCompany(
  input: ClientCompanyInput,
): Promise<ActionResult<{ id: number }>> {
  const parsed = clientCompanySchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.");

  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();

    const client = await prisma.clientCompany.create({
      data: { ...parsed.data, userId: session.user.id },
      select: { id: true },
    });

    revalidate();
    return ok({ id: client.id });
  } catch (error) {
    return toActionError("createClientCompany", error);
  }
}

export async function updateClientCompany(
  id: number,
  input: ClientCompanyInput,
): Promise<ActionResult> {
  const parsed = clientCompanySchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.");

  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();

    const { count } = await prisma.clientCompany.updateMany({
      where: { id, userId: session.user.id },
      data: parsed.data,
    });

    if (count === 0) return fail("That client is no longer in your workspace.");

    revalidate();
    return ok();
  } catch (error) {
    return toActionError("updateClientCompany", error);
  }
}

export async function deleteClientCompany(id: number): Promise<ActionResult> {
  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();

    const { count } = await prisma.clientCompany.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (count === 0) return fail("That client is no longer in your workspace.");

    revalidate();
    return ok();
  } catch (error) {
    return toActionError("deleteClientCompany", error, {
      inUse:
        "This client is used by an invoice. Invoices keep the billing details they were issued with, so the client cannot be deleted while they exist.",
    });
  }
}
