-- AddForeignKey
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

