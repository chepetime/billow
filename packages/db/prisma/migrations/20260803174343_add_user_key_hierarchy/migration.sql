-- AlterTable
ALTER TABLE "session" ADD COLUMN     "dataKeyWrappedBySessionKey" TEXT;

-- CreateTable
CREATE TABLE "UserKeyset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordSalt" TEXT NOT NULL,
    "dataKeyWrappedByPassword" TEXT NOT NULL,
    "recoverySalt" TEXT NOT NULL,
    "dataKeyWrappedByRecoveryKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserKeyset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOnboarding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recoveryKeyGeneratedAt" TIMESTAMP(3),
    "recoveryKeySavedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserKeyset_userId_key" ON "UserKeyset"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserOnboarding_userId_key" ON "UserOnboarding"("userId");

-- AddForeignKey
ALTER TABLE "UserKeyset" ADD CONSTRAINT "UserKeyset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOnboarding" ADD CONSTRAINT "UserOnboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
