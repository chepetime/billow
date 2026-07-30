-- An intentionally small encrypted-at-rest probe. The vault key is not a
-- column: ciphertext carries only a random salt, AEAD parameters and bytes.
CREATE TABLE "VaultEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VaultEntry_userId_key" ON "VaultEntry"("userId");
CREATE INDEX "VaultEntry_userId_idx" ON "VaultEntry"("userId");

ALTER TABLE "VaultEntry" ADD CONSTRAINT "VaultEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
