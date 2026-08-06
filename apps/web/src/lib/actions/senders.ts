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
  type SenderProfileInput,
  senderProfileSchema,
} from "@/lib/schemas/workspace";
import { getWorkspacePrisma } from "@/lib/workspace-prisma";

/**
 * Sender profiles — the "From" block on an invoice.
 *
 * `UserProfile.taxId` and `.address` are encrypted columns, so every write in
 * this file goes through `getWorkspacePrisma()`. Reaching for `getPrisma()`
 * here would store cleartext; a repo-wide source check in
 * `encrypted-writes.test.ts` fails the build if anyone does.
 */

function revalidate() {
  revalidatePath("/senders");
  revalidatePath("/dashboard");
}

export async function createSenderProfile(
  input: SenderProfileInput,
): Promise<ActionResult<{ id: number }>> {
  const parsed = senderProfileSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.");

  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();

    const profile = await prisma.userProfile.create({
      data: { ...parsed.data, userId: session.user.id },
      select: { id: true },
    });

    revalidate();
    return ok({ id: profile.id });
  } catch (error) {
    return toActionError("createSenderProfile", error);
  }
}

export async function updateSenderProfile(
  id: number,
  input: SenderProfileInput,
): Promise<ActionResult> {
  const parsed = senderProfileSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.");

  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();

    // Ownership is checked as part of the write, not before it: a findFirst
    // followed by an update-by-id is two statements with a gap in between,
    // and the `where` here is the same filter with no gap.
    const { count } = await prisma.userProfile.updateMany({
      where: { id, userId: session.user.id },
      data: parsed.data,
    });

    if (count === 0)
      return fail("That profile is no longer in your workspace.");

    revalidate();
    return ok();
  } catch (error) {
    return toActionError("updateSenderProfile", error);
  }
}

export async function deleteSenderProfile(id: number): Promise<ActionResult> {
  try {
    const { prisma } = await getWorkspacePrisma();
    const session = await requireSession();

    const { count } = await prisma.userProfile.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (count === 0)
      return fail("That profile is no longer in your workspace.");

    revalidate();
    return ok();
  } catch (error) {
    return toActionError("deleteSenderProfile", error, {
      inUse:
        "This profile is used by an invoice. Invoices keep the details they were issued with, so the profile cannot be deleted while they exist.",
    });
  }
}
