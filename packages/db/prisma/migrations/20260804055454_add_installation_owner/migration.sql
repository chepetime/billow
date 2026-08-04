-- CreateTable
CREATE TABLE "installation_owner" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "userId" TEXT NOT NULL,

    CONSTRAINT "installation_owner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "installation_owner_userId_key" ON "installation_owner"("userId");

-- AddForeignKey
ALTER TABLE "installation_owner" ADD CONSTRAINT "installation_owner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: an installation that already has accounts already has an owner.
--
-- Without this the table starts empty on every existing install, and the next
-- account to register wins the claim and is promoted to admin. That is a
-- privilege escalation the `user.count() = 1` check this replaces did not
-- have, and it is reachable whenever an admin re-opens registration.
--
-- Prefers the earliest admin, falling back to the earliest account, which is
-- what the old first-account-owns-the-install rule would have chosen.
INSERT INTO "installation_owner" ("id", "userId")
SELECT 1, u."id"
FROM "user" u
ORDER BY (u."role" = 'admin') DESC NULLS LAST, u."createdAt" ASC
LIMIT 1
ON CONFLICT ("id") DO NOTHING;
