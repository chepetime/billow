-- Billow: identify duplicate workspace rows and where they came from.
-- Read-only. Run first, decide the canonical ids, then run 02-merge.sql.

\echo '== user profiles =='
SELECT p.id, p."userId", p."displayName", p."legalName",
       (SELECT count(*) FROM "BankAccount" b WHERE b."userProfileId" = p.id) AS bank_accounts,
       (SELECT count(*) FROM "Invoice" i WHERE i."userProfileId" = p.id)     AS invoices
FROM "UserProfile" p ORDER BY p.id;

\echo '== bank accounts =='
SELECT b.id, b."userProfileId", b.label, b."bankName", b."isDefault",
       (SELECT count(*) FROM "Invoice" i WHERE i."bankAccountId" = b.id) AS invoices
FROM "BankAccount" b ORDER BY b.id;

\echo '== clients =='
SELECT c.id, c."userId", c.name,
       (SELECT count(*) FROM "Invoice" i WHERE i."clientCompanyId" = c.id) AS invoices
FROM "ClientCompany" c ORDER BY c.id;

\echo '== which invoice points where =='
SELECT i."invoiceNumber", i.status, i."userProfileId", i."bankAccountId", i."clientCompanyId"
FROM "Invoice" i ORDER BY i."invoiceNumber";

-- Which code path created these. The three candidates leave different traces:
--   userId IS NULL on a profile/client  -> packages/db/prisma/seed.mjs, which
--     inserts no userId and is guarded by "no profiles exist yet"
--   editor = 'onboarding'               -> createWorkspaceFromOnboarding
--   anything else, in duplicate         -> importWorkspace restoring a backup
--     onto a workspace that already had data, which creates unconditionally
\echo '== origin of each invoice, from its first revision =='
SELECT i."invoiceNumber", r."revisionNumber", r.editor, r.summary, r."createdAt"
FROM "Invoice" i
JOIN "InvoiceRevision" r ON r."invoiceId" = i.id AND r."revisionNumber" = 1
ORDER BY r."createdAt";

\echo '== profiles/clients with no owner (seed leftovers) =='
SELECT 'UserProfile' AS model, id::text FROM "UserProfile" WHERE "userId" IS NULL
UNION ALL
SELECT 'ClientCompany', id::text FROM "ClientCompany" WHERE "userId" IS NULL;
