-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'attachment',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Upload_storageKey_key" ON "Upload"("storageKey");

-- CreateIndex
CREATE INDEX "Upload_userId_idx" ON "Upload"("userId");

-- CreateIndex
CREATE INDEX "Upload_userId_kind_idx" ON "Upload"("userId", "kind");

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

