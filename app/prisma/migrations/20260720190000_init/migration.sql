CREATE TABLE "AppMetadata" (
    "id" SERIAL NOT NULL,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dockerImage" TEXT NOT NULL,
    "repositoryUrl" TEXT,
    "supportUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppMetadata_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppMetadata_appId_key" ON "AppMetadata"("appId");
