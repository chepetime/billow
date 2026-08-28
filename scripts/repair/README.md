# Workspace repair

One-off SQL for a workspace that ended up with duplicate sender profiles, bank
accounts and clients, with invoices split between the copies.

## How a workspace gets into that state

`importWorkspace` maps the ids in a backup onto **newly created** rows rather
than reconciling with existing ones, so a restore onto a workspace that already
held data produced a second copy of everything. Since 0.1.6 the restore route
refuses a non-empty workspace and points at the workspace reset, so this should
not recur — but an install that restored before then still carries the damage,
and `chepetime/umbrel-goose` is a copy of this tree with the same history.

It is **not** the database seed. `packages/db/prisma/seed.mjs` is guarded by
"no profiles exist yet" and inserts rows with no `userId` at all.

## Running it

On an Umbrel install, Postgres is a sibling container:

```sh
DB=chepetime-billow_db_1

# 1. Read-only. Decide which ids to keep from the output.
docker exec -i "$DB" psql -U billow -d billow -f - < 01-diagnose.sql

# 2. Ends in ROLLBACK. Read the before/after, then change the last line to
#    COMMIT and run it again.
docker exec -i "$DB" psql -U billow -d billow \
  -v keep_profile=3 -v drop_profile=4 \
  -v keep_bank=3    -v drop_bank=4 \
  -v keep_client=3  -v drop_client=4 \
  -f - < 02-merge.sql
```

Take a backup first — Billow's own export, or `pg_dump`.

## Why it is safe

`Invoice.userProfileId`, `.bankAccountId` and `.clientCompanyId` are all
`onDelete: Restrict`. If a repoint is missed, the `DELETE` aborts the
transaction instead of taking an invoice with it. That was verified against a
real database, not assumed:

```text
before:  clientCompanyId 3 -> 2,  4 -> 7
after:   clientCompanyId 3 -> 9      (9 invoices intact, 1 profile, 1 bank, 1 client)
```

`InvoiceRevision` payloads keep naming the old ids on purpose. A revision
records what was true when the edit happened; rewriting it would make the audit
trail lie about a merge that did occur.
