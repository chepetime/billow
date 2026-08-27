"use server";

import { auth, requireSession } from "@billow/auth";
import { revalidatePath } from "next/cache";

import {
  type ActionResult,
  fail,
  ok,
  toActionError,
} from "@/lib/actions/result";
import { permissionsFor } from "@/lib/api/api-key-scope";
import {
  type CreateApiKeyInput,
  createApiKeySchema,
} from "@/lib/schemas/api-keys";

/**
 * API key creation, moved off the client plugin.
 *
 * `authClient.apiKey.create()` cannot set a scope: BetterAuth treats
 * `permissions` as a server-only property and rejects any request carrying one
 * that arrived with headers. So a key created from the browser is unscoped,
 * and an unscoped key is the thing scopes exist to stop.
 *
 * Called with an explicit `userId` and no headers, which is the same rule from
 * the other side — that shape is only reachable from server code, so the
 * session is resolved here first and its user is what gets passed.
 */
export async function createApiKey(
  input: CreateApiKeyInput,
): Promise<ActionResult<{ key: string; name: string }>> {
  const parsed = createApiKeySchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.");

  const session = await requireSession();
  const name = parsed.data.name || "Personal key";

  try {
    const created = await auth.api.createApiKey({
      body: {
        name,
        userId: session.user.id,
        permissions: permissionsFor(parsed.data.grant),
      },
    });

    revalidatePath("/settings/api-keys");
    // The plaintext key is returned exactly once, here. Everything downstream
    // stores only the hash.
    return ok({ key: created.key, name });
  } catch (error) {
    return toActionError("createApiKey", error);
  }
}
