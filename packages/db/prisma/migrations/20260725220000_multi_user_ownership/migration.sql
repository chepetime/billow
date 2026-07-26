CREATE TABLE "RegistrationSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "RegistrationSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UserProfile" ADD COLUMN "userId" TEXT;
ALTER TABLE "ClientCompany" ADD COLUMN "userId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "userId" TEXT;

DO $$
DECLARE
  owner_id TEXT;
BEGIN
  SELECT "id" INTO owner_id FROM "user" ORDER BY "createdAt" ASC LIMIT 1;

  IF owner_id IS NOT NULL THEN
    UPDATE "UserProfile" SET "userId" = owner_id WHERE "userId" IS NULL;
    UPDATE "ClientCompany" SET "userId" = owner_id WHERE "userId" IS NULL;
    UPDATE "Invoice" SET "userId" = owner_id WHERE "userId" IS NULL;
  END IF;
END $$;

DROP INDEX "Invoice_invoiceNumber_key";
CREATE UNIQUE INDEX "Invoice_userId_invoiceNumber_key" ON "Invoice"("userId", "invoiceNumber");
CREATE INDEX "UserProfile_userId_idx" ON "UserProfile"("userId");
CREATE INDEX "ClientCompany_userId_idx" ON "ClientCompany"("userId");
CREATE INDEX "Invoice_userId_idx" ON "Invoice"("userId");

ALTER TABLE "UserProfile"
  ADD CONSTRAINT "UserProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientCompany"
  ADD CONSTRAINT "ClientCompany_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
