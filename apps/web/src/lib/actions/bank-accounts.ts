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
  type BankAccountInput,
  bankAccountSchema,
} from "@/lib/schemas/workspace";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

/**
 * Bank accounts — the payment instructions on an invoice, and the model with
 * the most encrypted columns (nine of them). Every write goes through
 * `getWorkspacePrisma()`; see the note in `senders.ts`.
 *
 * A bank account hangs off a sender profile rather than off the user
 * directly, so every ownership check here reaches through the profile.
 */

function revalidate() {
  revalidatePath("/banks");
  revalidatePath("/dashboard");
}

export async function createBankAccount(
  input: BankAccountInput,
): Promise<ActionResult<{ id: number }>> {
  const parsed = bankAccountSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.");

  const { userProfileId, isDefault, ...fields } = parsed.data;

  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();
    const userId = session.user.id;

    const id = await prisma.$transaction(async (tx) => {
      const profile = await tx.userProfile.findFirst({
        where: { id: userProfileId, userId },
        select: { id: true },
      });
      if (!profile) return null;

      // Two accounts both flagged default is a state with no correct
      // resolution at read time, so it is prevented at write time.
      if (isDefault) {
        await tx.bankAccount.updateMany({
          where: { userProfile: { userId } },
          data: { isDefault: false },
        });
      }

      const created = await tx.bankAccount.create({
        data: { ...fields, userProfileId, isDefault },
        select: { id: true },
      });

      return created.id;
    });

    if (id === null)
      return fail("That sender profile is not in your workspace.");

    revalidate();
    return ok({ id });
  } catch (error) {
    return toActionError("createBankAccount", error);
  }
}

export async function updateBankAccount(
  id: number,
  input: BankAccountInput,
): Promise<ActionResult> {
  const parsed = bankAccountSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.");

  const { userProfileId, isDefault, ...fields } = parsed.data;

  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();
    const userId = session.user.id;

    const updated = await prisma.$transaction(async (tx) => {
      const [account, profile] = await Promise.all([
        tx.bankAccount.findFirst({
          where: { id, userProfile: { userId } },
          select: { id: true },
        }),
        tx.userProfile.findFirst({
          where: { id: userProfileId, userId },
          select: { id: true },
        }),
      ]);
      if (!account || !profile) return false;

      if (isDefault) {
        await tx.bankAccount.updateMany({
          where: { userProfile: { userId }, id: { not: id } },
          data: { isDefault: false },
        });
      }

      await tx.bankAccount.update({
        where: { id },
        data: { ...fields, userProfileId, isDefault },
      });

      return true;
    });

    if (!updated) return fail("That account is no longer in your workspace.");

    revalidate();
    return ok();
  } catch (error) {
    return toActionError("updateBankAccount", error);
  }
}

export async function deleteBankAccount(id: number): Promise<ActionResult> {
  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();

    const { count } = await prisma.bankAccount.deleteMany({
      where: { id, userProfile: { userId: session.user.id } },
    });

    if (count === 0)
      return fail("That account is no longer in your workspace.");

    revalidate();
    return ok();
  } catch (error) {
    return toActionError("deleteBankAccount", error, {
      inUse:
        "This account is used by an invoice. Invoices keep the payment details they were issued with, so the account cannot be deleted while they exist.",
    });
  }
}
