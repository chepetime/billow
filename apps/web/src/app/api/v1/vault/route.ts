import { getPrisma } from "@billow/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiIdentity } from "@/lib/api/identity";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { error, rateLimited } from "@/lib/api/respond";
import {
  decryptVaultPayload,
  encryptVaultPayload,
  VaultCryptoError,
} from "@/lib/vault-crypto";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({ secret: z.string().min(1).max(4096) });
const noStore = { "Cache-Control": "no-store" };

function vaultKey(request: Request): string | null {
  // This header is intentionally never logged or copied into an error.
  //
  // It is NOT protected in transit on a default install. Umbrel serves this app
  // over plain HTTP at `umbrel.local:<port>` — which is exactly why
  // lib/security-headers.ts omits HSTS and why passkeys are still deferred — so
  // the vault key crosses the local network in cleartext on every save and
  // every unlock. Anyone able to observe that traffic sees the key that
  // protects the ciphertext, which defeats the point of encrypting it.
  //
  // Encryption at rest still holds: a database dump remains useless on its own.
  // But this is only meaningfully private when the app is reached over HTTPS
  // (a tunnel, or Tailscale). The UI says so where the key is entered.
  //
  // A modified self-hosted runtime could also read the key regardless of
  // transport, which is the documented limit of the whole experiment.
  return request.headers.get("x-billow-vault-key");
}

// Methods that change state, and so are the ones a cross-site page could be
// tricked into triggering with the user's cookie.
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function identityFor(request: Request) {
  const identity = await requireApiIdentity(request.headers);
  if (identity instanceof NextResponse) return identity;

  // The origin check applies to mutations only, matching what
  // isSameOriginRequest documents itself as ("reject cookie-authenticated
  // mutations") and how the restore route uses it.
  //
  // Applying it to GET as well looks stricter but breaks the feature: browsers
  // do not send `Origin` on a same-origin GET, so the vault's own Unlock button
  // was answered with 403 before it ever reached the key check. The e2e
  // isolation test caught this by expecting 401 and receiving 403.
  //
  // GET needs no CSRF guard of its own: it changes nothing, and reading it
  // cross-origin requires the custom vault-key header, which forces a CORS
  // preflight that this app never answers.
  if (
    MUTATING_METHODS.has(request.method) &&
    identity.via === "session" &&
    !isSameOriginRequest(request)
  ) {
    return error("Invalid request origin.", 403);
  }

  return identity;
}

/**
 * The vault derives its key with scrypt on every read and every write, at
 * N=32768 with a 64 MB memory bound. Against a 128 MB old-space cap that is
 * two concurrent requests from exhausting the heap, so this throttle protects
 * the process at least as much as it slows a guesser.
 */
async function overVaultLimit(userId: string) {
  const limit = await consumeRateLimit(`vault:${userId}`, 20, 60);
  if (limit.allowed) return null;
  return rateLimited(
    `Too many vault requests. Try again in ${limit.retryAfter} seconds.`,
    limit.retryAfter,
  );
}

export async function GET(request: Request) {
  const identity = await identityFor(request);
  if (identity instanceof NextResponse) return identity;
  const key = vaultKey(request);
  if (!key) return error("Enter your vault key to unlock this entry.", 401);

  const throttled = await overVaultLimit(identity.userId);
  if (throttled) return throttled;

  const entry = await getPrisma().vaultEntry.findUnique({
    where: { userId: identity.userId },
  });
  if (!entry) return error("No vault entry exists yet.", 404);

  try {
    return NextResponse.json(
      {
        secret: await decryptVaultPayload(
          identity.userId,
          key,
          entry.ciphertext,
        ),
      },
      { headers: noStore },
    );
  } catch (err) {
    if (err instanceof VaultCryptoError)
      return error("The vault key cannot unlock this entry.", 401);
    throw err;
  }
}

export async function POST(request: Request) {
  const identity = await identityFor(request);
  if (identity instanceof NextResponse) return identity;
  const key = vaultKey(request);
  if (!key) return error("Enter a vault key before saving.", 400);

  const throttled = await overVaultLimit(identity.userId);
  if (throttled) return throttled;

  const body = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return error("Enter a vault note up to 4,096 characters.", 400);

  const ciphertext = await encryptVaultPayload(
    identity.userId,
    key,
    body.data.secret,
  );
  await getPrisma().vaultEntry.upsert({
    where: { userId: identity.userId },
    create: { userId: identity.userId, ciphertext },
    update: { ciphertext },
  });
  return NextResponse.json({ saved: true }, { status: 201, headers: noStore });
}

export async function DELETE(request: Request) {
  const identity = await identityFor(request);
  if (identity instanceof NextResponse) return identity;

  await getPrisma().vaultEntry.deleteMany({
    where: { userId: identity.userId },
  });
  return new NextResponse(null, { status: 204, headers: noStore });
}
