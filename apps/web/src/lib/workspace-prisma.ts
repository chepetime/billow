import "server-only";

import { getDataKey, getSession } from "@billow/auth";
import { getPrisma } from "@billow/db";
import { encryptedPrisma } from "@billow/db/field-encryption";

/**
 * The Prisma client for the signed-in request, encrypting and decrypting the
 * fields in `ENCRYPTED_FIELDS` when this request can reach a data key.
 *
 * `encrypted` is false for an API-key caller, a session created before keysets
 * existed, or a browser missing the data-key cookie. Those callers see
 * encrypted columns as ciphertext, which is the honest outcome: the key
 * belongs to the signed-in person, not to a token in a script. Anything
 * rendering those fields should check `encrypted` and say the value is
 * unavailable rather than print an envelope at the user.
 *
 * The keyless branches hand back `getPrisma()`, which refuses a plaintext
 * write to an encrypted column rather than performing it, so neither branch
 * can quietly become the plaintext path: a caller that reaches an encrypted
 * column with no key fails the write instead of storing cleartext for the next
 * database dump to find. That is the whole reason this module exists — every
 * write to those models is supposed to come through here.
 */
export async function getWorkspacePrisma() {
  const session = await getSession();
  if (!session) return { prisma: getPrisma(), encrypted: false as const };

  const dataKey = await getDataKey(session.user.id, session.session.id);
  if (!dataKey) return { prisma: getPrisma(), encrypted: false as const };

  return { prisma: encryptedPrisma(dataKey), encrypted: true as const };
}
