"use server";

import { requireSession } from "@billow/auth";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, ok } from "@/lib/actions/result";
import type { InvoiceInput } from "@/lib/schemas/workspace";
import * as invoices from "@/lib/workspace/invoices";
import type { WorkspaceResult } from "@/lib/workspace/rule";

/**
 * The browser's half of the invoice rules.
 *
 * Wrappers only — every rule lives in `lib/workspace/invoices.ts`, which
 * `app/api/v1/invoices` calls with the same arguments and a different user.
 * `via` is passed through so a revision records whether an edit came from a
 * signed-in person or from a key running in a script.
 */

const DUPLICATE_NUMBER =
  "You already have an invoice with that number. Pick another.";

const MISSING = "That invoice is no longer in your workspace.";

function revalidate(id?: string) {
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  if (id !== undefined) {
    revalidatePath(`/invoices/${id}`);
    revalidatePath(`/invoices/${id}/edit`);
  }
}

/**
 * Reason to copy.
 *
 * `not_found` covers two cases the rules deliberately do not tell apart — the
 * invoice is gone, or one of its references is not this account's — so the
 * message names both rather than claiming the invoice vanished.
 */
function toActionResult<T>(result: WorkspaceResult<T>): ActionResult<T> {
  if (result.ok) return ok(result.data);

  switch (result.reason) {
    case "invalid":
      return fail("Check the highlighted fields.");
    case "not_found":
      return fail(
        "That invoice, or the sender, bank account or client it points at, is no longer in your workspace.",
      );
    case "conflict":
      return fail(DUPLICATE_NUMBER);
    case "in_use":
      return fail("Something still refers to this invoice.");
    case "no_key":
      return fail(
        "Your encryption key is not available in this session. Sign out and back in, then try again.",
      );
    case "failed":
      return fail("Something went wrong saving that. Please try again.");
  }
}

export async function createInvoice(
  input: InvoiceInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  const result = await invoices.createInvoice(session.user.id, input, {
    via: "session",
  });
  if (!result.ok) return toActionResult(result);

  revalidate(result.data.publicId);
  return ok({ id: result.data.publicId });
}

export async function updateInvoice(
  id: string,
  input: InvoiceInput,
): Promise<ActionResult> {
  const session = await requireSession();
  const result = await invoices.updateInvoice(session.user.id, id, input, {
    via: "session",
  });
  if (!result.ok) return toActionResult(result);

  revalidate(id);
  return ok();
}

export async function deleteInvoice(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const result = await invoices.deleteInvoice(session.user.id, id);
  if (!result.ok) {
    return result.reason === "not_found"
      ? fail(MISSING)
      : toActionResult(result);
  }

  revalidate();
  return ok();
}

export async function duplicateInvoice(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  const result = await invoices.duplicateInvoice(session.user.id, id, {
    via: "session",
  });
  if (!result.ok) return toActionResult(result);

  revalidate(result.data.publicId);
  return ok({ id: result.data.publicId });
}
