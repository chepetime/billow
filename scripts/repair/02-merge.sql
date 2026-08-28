-- Billow: merge duplicate workspace rows onto canonical ones.
--
-- Set the four ids below, then run. Everything is inside one transaction that
-- ROLLS BACK by default -- read the output, and only then change the last line
-- to COMMIT and run it again.
--
--   psql "$DATABASE_URL" -v keep_profile=3 -v drop_profile=4 \
--        -v keep_bank=3 -v drop_bank=4 -v keep_client=3 -v drop_client=4 \
--        -f 02-merge.sql
--
-- Order matters. Invoice.userProfileId, .bankAccountId and .clientCompanyId
-- are all onDelete: Restrict, so Postgres refuses to drop a row an invoice
-- still points at -- which is the safety net here: if a repoint is missed, the
-- delete fails rather than taking an invoice with it. BankAccount.userProfileId
-- is onDelete: Cascade, so dropping a profile also drops any bank account still
-- under it; that only succeeds if no invoice references those either.

BEGIN;

\echo '--- before ---'
SELECT "clientCompanyId", count(*) FROM "Invoice" GROUP BY 1 ORDER BY 1;
SELECT "bankAccountId",   count(*) FROM "Invoice" GROUP BY 1 ORDER BY 1;
SELECT "userProfileId",   count(*) FROM "Invoice" GROUP BY 1 ORDER BY 1;

-- 1. Repoint every invoice off the duplicates.
UPDATE "Invoice" SET "clientCompanyId" = :keep_client WHERE "clientCompanyId" = :drop_client;
UPDATE "Invoice" SET "bankAccountId"   = :keep_bank   WHERE "bankAccountId"   = :drop_bank;
UPDATE "Invoice" SET "userProfileId"   = :keep_profile WHERE "userProfileId"  = :drop_profile;

-- 2. Any bank account still under the dropped profile that an invoice uses
--    must move too, or the cascade in step 4 would be blocked by Restrict.
UPDATE "BankAccount" SET "userProfileId" = :keep_profile WHERE "userProfileId" = :drop_profile;

-- 3. Drop the duplicate client and bank account. Both fail loudly if step 1
--    missed anything.
DELETE FROM "ClientCompany" WHERE id = :drop_client;
DELETE FROM "BankAccount"   WHERE id = :drop_bank;

-- 4. Drop the duplicate profile.
DELETE FROM "UserProfile" WHERE id = :drop_profile;

\echo '--- after ---'
SELECT "clientCompanyId", count(*) FROM "Invoice" GROUP BY 1 ORDER BY 1;
SELECT "bankAccountId",   count(*) FROM "Invoice" GROUP BY 1 ORDER BY 1;
SELECT "userProfileId",   count(*) FROM "Invoice" GROUP BY 1 ORDER BY 1;

\echo '--- nothing should reference the dropped ids ---'
SELECT count(*) AS dangling FROM "Invoice"
WHERE "clientCompanyId" = :drop_client
   OR "bankAccountId"   = :drop_bank
   OR "userProfileId"   = :drop_profile;

-- InvoiceRevision payloads still name the old ids. That is deliberate: a
-- revision records what was true when the edit happened, and rewriting it
-- would make the audit trail lie about a merge that did occur.

ROLLBACK;  -- change to COMMIT once the output above looks right
