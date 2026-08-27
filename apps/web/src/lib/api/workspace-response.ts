import type { NextResponse } from "next/server";

import { error, validationError } from "@/lib/api/respond";
import type { WorkspaceResult } from "@/lib/workspace/result";

/**
 * The API's half of the workspace rules: one refusal reason to one HTTP
 * status, for every entity.
 *
 * This is the counterpart of `toActionResult` in `lib/actions/clients.ts`.
 * Between them they are the whole reason the rules layer returns reasons
 * rather than sentences — the same refusal has to become a red line under a
 * form field for one caller and a 409 for the other, and neither mapping
 * belongs inside the rule.
 *
 * The switch is exhaustive: a new `WorkspaceErrorReason` fails the build here
 * rather than falling through to a 500 that says nothing useful.
 */
export function workspaceError(
  result: Extract<WorkspaceResult<unknown>, { ok: false }>,
): NextResponse {
  switch (result.reason) {
    case "invalid":
      // Same body shape as validationError's, so a client parses one error
      // format across the whole API.
      return validationError(result.fields ?? {});
    case "not_found":
      return error("Not found.", 404);
    case "conflict":
      return error("That conflicts with a record you already have.", 409);
    case "in_use":
      return error(
        "Another record still refers to this one, so it cannot be deleted.",
        409,
      );
    case "no_key":
      // Not an authentication failure — the credential is fine. This value is
      // sealed under the owner's data key, which only a signed-in browser
      // holds, so no API key can ever write it. See lib/workspace-prisma.ts.
      return error(
        "This field is encrypted under the account owner's key, which an API key cannot reach. Make this change while signed in.",
        409,
      );
    case "failed":
      return error("Something went wrong. Please try again.", 500);
  }
}
