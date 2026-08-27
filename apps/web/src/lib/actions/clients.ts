"use server";

import { requireSession } from "@billow/auth";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, ok } from "@/lib/actions/result";
import type { ClientCompanyInput } from "@/lib/schemas/workspace";
import * as clients from "@/lib/workspace/clients";
import type { WorkspaceResult } from "@/lib/workspace/result";

/**
 * The browser's half of the client-company rules.
 *
 * Everything here is a wrapper: supply the session's user, call the rule in
 * `lib/workspace/clients.ts`, revalidate the pages that changed, and turn the
 * refusal reason into the sentence the form shows. No rule lives in this file,
 * which is the point — `app/api/v1/clients` calls the same functions with a
 * different user and maps the same reasons to HTTP statuses, so the two
 * callers cannot disagree about who owns what or when a delete is refused.
 */

function revalidate() {
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

const IN_USE =
  "This client is used by an invoice. Invoices keep the billing details they were issued with, so the client cannot be deleted while they exist.";

/**
 * Reason to copy. Exhaustive on purpose: adding a reason to
 * `WorkspaceErrorReason` should stop the build here rather than silently fall
 * through to "Something went wrong".
 */
function toActionResult<T>(result: WorkspaceResult<T>): ActionResult<T> {
  if (result.ok) return ok(result.data);

  switch (result.reason) {
    case "invalid":
      return fail("Check the highlighted fields.");
    case "not_found":
      return fail("That client is no longer in your workspace.");
    case "in_use":
      return fail(IN_USE);
    case "conflict":
      return fail("Those details clash with a client you already have.");
    case "no_key":
      return fail(
        "Your encryption key is not available in this session. Sign out and back in, then try again.",
      );
    case "failed":
      return fail("Something went wrong saving that. Please try again.");
  }
}

/**
 * The rules return the stored row; the forms only ever needed the new id (to
 * redirect) or nothing at all. Narrowing here rather than widening the action's
 * contract keeps the extra columns out of the client bundle — a server action's
 * return value is serialised and shipped to the browser.
 */
export async function createClientCompany(
  input: ClientCompanyInput,
): Promise<ActionResult<{ id: number }>> {
  const session = await requireSession();
  const result = await clients.createClientCompany(session.user.id, input);
  if (!result.ok) return toActionResult(result);

  revalidate();
  return ok({ id: result.data.id });
}

export async function updateClientCompany(
  id: number,
  input: ClientCompanyInput,
): Promise<ActionResult> {
  const session = await requireSession();
  const result = await clients.updateClientCompany(session.user.id, id, input);
  if (!result.ok) return toActionResult(result);

  revalidate();
  return ok();
}

export async function deleteClientCompany(id: number): Promise<ActionResult> {
  const session = await requireSession();
  const result = await clients.deleteClientCompany(session.user.id, id);
  if (result.ok) revalidate();
  return toActionResult(result);
}
