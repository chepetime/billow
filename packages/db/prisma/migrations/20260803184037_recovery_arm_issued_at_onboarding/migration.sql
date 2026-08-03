-- AlterTable
ALTER TABLE "UserKeyset" ALTER COLUMN "recoverySalt" DROP NOT NULL,
ALTER COLUMN "dataKeyWrappedByRecoveryKey" DROP NOT NULL;
