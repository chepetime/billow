import "server-only";

import { getDataKey, getSession } from "@billow/auth";
import { getPrisma } from "@billow/db";
import { encryptedPrisma } from "@billow/db/field-encryption";

/**
 * The Prisma client for the signed-in request, encrypting and decrypting the
 * fields in `ENCRYPTED_FIELDS` when this request can reach a data key.
 *
 * `encrypted` is false for an API-key caller, a session created before keysets
 * existed, or a browser missing the data-key cookie. Those callers get the
 * plain client and see encrypted columns as ciphertext, which is the honest
 * outcome: the key belongs to the signed-in person, not to a token in a
 * script. Anything rendering those fields should check `encrypted` and say the
 * value is unavailable rather than print an envelope at the user.
 */
export async function getWorkspacePrisma() {
  const session = await getSession();
  if (!session) return { prisma: getPrisma(), encrypted: false as const };

  const dataKey = await getDataKey(session.user.id, session.session.id);
  if (!dataKey) return { prisma: getPrisma(), encrypted: false as const };

  return { prisma: encryptedPrisma(dataKey), encrypted: true as const };
}
