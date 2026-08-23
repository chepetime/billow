ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'APPROVED' AFTER 'SENT';

CREATE TYPE "InvoiceDocumentKind" AS ENUM (
  'CFDI_XML',
  'CFDI_PDF',
  'PAYMENT_PROOF',
  'SIGNED_COPY',
  'OTHER'
);

CREATE TYPE "TaxPeriodDocumentKind" AS ENUM (
  'TAX_RETURN',
  'PAYMENT_CONFIRMATION',
  'OTHER'
);

ALTER TABLE "Invoice"
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "cfdiIssuedAt" TIMESTAMP(3);

UPDATE "Invoice"
SET "sentAt" = "updatedAt"
WHERE "status" IN ('SENT', 'PAID', 'TAX_RECEIPT', 'TAX_RETURN', 'DONE');

UPDATE "Invoice"
SET "approvedAt" = "updatedAt"
WHERE "status" IN ('PAID', 'TAX_RECEIPT', 'TAX_RETURN', 'DONE');

UPDATE "Invoice"
SET "paidAt" = "updatedAt"
WHERE "status" IN ('PAID', 'TAX_RECEIPT', 'TAX_RETURN', 'DONE');

UPDATE "Invoice"
SET "cfdiIssuedAt" = "updatedAt"
WHERE "status" IN ('TAX_RECEIPT', 'TAX_RETURN', 'DONE');

CREATE TABLE "InvoiceDocument" (
  "id" SERIAL NOT NULL,
  "invoiceId" INTEGER NOT NULL,
  "uploadId" TEXT NOT NULL,
  "kind" "InvoiceDocumentKind" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxPeriod" (
  "id" SERIAL NOT NULL,
  "userId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'MXN',
  "amountPaid" DECIMAL(12, 2),
  "filedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxPeriodDocument" (
  "id" SERIAL NOT NULL,
  "taxPeriodId" INTEGER NOT NULL,
  "uploadId" TEXT NOT NULL,
  "kind" "TaxPeriodDocumentKind" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxPeriodDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceDocument_uploadId_key" ON "InvoiceDocument"("uploadId");
CREATE UNIQUE INDEX "InvoiceDocument_invoiceId_kind_key" ON "InvoiceDocument"("invoiceId", "kind");
CREATE INDEX "InvoiceDocument_invoiceId_idx" ON "InvoiceDocument"("invoiceId");

CREATE UNIQUE INDEX "TaxPeriod_userId_year_month_key" ON "TaxPeriod"("userId", "year", "month");
CREATE INDEX "TaxPeriod_userId_filedAt_idx" ON "TaxPeriod"("userId", "filedAt");
CREATE INDEX "TaxPeriod_userId_paidAt_idx" ON "TaxPeriod"("userId", "paidAt");

CREATE UNIQUE INDEX "TaxPeriodDocument_uploadId_key" ON "TaxPeriodDocument"("uploadId");
CREATE UNIQUE INDEX "TaxPeriodDocument_taxPeriodId_kind_key" ON "TaxPeriodDocument"("taxPeriodId", "kind");
CREATE INDEX "TaxPeriodDocument_taxPeriodId_idx" ON "TaxPeriodDocument"("taxPeriodId");

CREATE INDEX "Invoice_userId_sentAt_idx" ON "Invoice"("userId", "sentAt");
CREATE INDEX "Invoice_userId_approvedAt_idx" ON "Invoice"("userId", "approvedAt");
CREATE INDEX "Invoice_userId_paidAt_idx" ON "Invoice"("userId", "paidAt");
CREATE INDEX "Invoice_userId_cfdiIssuedAt_idx" ON "Invoice"("userId", "cfdiIssuedAt");

ALTER TABLE "InvoiceDocument"
  ADD CONSTRAINT "InvoiceDocument_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceDocument"
  ADD CONSTRAINT "InvoiceDocument_uploadId_fkey"
  FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxPeriod"
  ADD CONSTRAINT "TaxPeriod_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxPeriodDocument"
  ADD CONSTRAINT "TaxPeriodDocument_taxPeriodId_fkey"
  FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxPeriodDocument"
  ADD CONSTRAINT "TaxPeriodDocument_uploadId_fkey"
  FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
