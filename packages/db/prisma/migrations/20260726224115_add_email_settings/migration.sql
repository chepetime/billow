-- CreateTable
CREATE TABLE "EmailSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "apiKey" TEXT,
    "apiKeyHint" TEXT,
    "fromEmail" TEXT,
    "fromName" TEXT,
    "publicUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "EmailSettings_pkey" PRIMARY KEY ("id")
);
