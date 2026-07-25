-- AlterTable
ALTER TABLE "twoFactor" ADD COLUMN     "failedVerificationCount" INTEGER DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

