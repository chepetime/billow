import { NextResponse } from "next/server";

import { getPrisma } from "@billow/db";
import { z } from "zod";
import { requireApiIdentity } from "@/lib/api/identity";
import { error } from "@/lib/api/respond";
import { isSameOriginRequest } from "@/lib/api/request-origin";
import { decryptVaultPayload, encryptVaultPayload, VaultCryptoError } from "@/lib/vault-crypto";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({ secret: z.string().min(1).max(4096) });
const noStore = { "Cache-Control": "no-store" };

function isCredentialedByApiKey(request: Request): boolean {
  return Boolean(request.headers.get("x-api-key") || request.headers.get("authorization"));
}

function vaultKey(request: Request): string | null {
  // This header is intentionally never logged or copied into an error. TLS
  // protects it in transit; a modified self-hosted runtime could still read it,
  // which is the documented limit of this experiment.
  return request.headers.get("x-billow-vault-key");
}

async function identityFor(request: Request) {
  const identity = await requireApiIdentity(request.headers);
  if (identity instanceof NextResponse) return identity;
  if (!isCredentialedByApiKey(request) && !isSameOriginRequest(request)) {
    return error("Invalid request origin.", 403);
  }
  return identity;
}

export async function GET(request: Request) {
  const identity = await identityFor(request);
  if (identity instanceof NextResponse) return identity;
  const key = vaultKey(request);
  if (!key) return error("Enter your vault key to unlock this entry.", 401);

  const entry = await getPrisma().vaultEntry.findUnique({ where: { userId: identity.userId } });
  if (!entry) return error("No vault entry exists yet.", 404);

  try {
    return NextResponse.json(
      { secret: await decryptVaultPayload(identity.userId, key, entry.ciphertext) },
      { headers: noStore },
    );
  } catch (err) {
    if (err instanceof VaultCryptoError) return error("The vault key cannot unlock this entry.", 401);
    throw err;
  }
}

export async function POST(request: Request) {
  const identity = await identityFor(request);
  if (identity instanceof NextResponse) return identity;
  const key = vaultKey(request);
  if (!key) return error("Enter a vault key before saving.", 400);

  const body = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return error("Enter a vault note up to 4,096 characters.", 400);

  const ciphertext = await encryptVaultPayload(identity.userId, key, body.data.secret);
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

  await getPrisma().vaultEntry.deleteMany({ where: { userId: identity.userId } });
  return new NextResponse(null, { status: 204, headers: noStore });
}
