# Billow Platform Audit

**Date:** 2026-08-03 · **Version audited:** 0.1.42 · **Branch:** `main` @ `3a7203a`

Scope: monorepo layout, Dockerfile and runtime, CI/CD, auth and key hierarchy,
field encryption, API surface, uploads, backup/restore, and data fetching.

`BASELINE.md` remains the platform checklist and `TODO.md` the roadmap. This
file is a point-in-time review and does not supersede either — where it
disagrees with a checkbox, grep the code before trusting either one.

---

## Overall assessment

This is well above the bar for a self-hosted app. The things that usually rot —
release provenance, image size, migration-on-boot, CSRF origin derivation,
upload type sniffing, path traversal — are not just handled but handled with
the reasoning recorded next to the code.

`packages/crypto/src/key-hierarchy.ts` is a genuinely good envelope-encryption
design: a per-user data key, AAD binding both owner and purpose so wraps cannot
be moved between slots or accounts, and random (not derived) session keys so
the hot path never runs a KDF. The `Dockerfile` comments explaining why
`@prisma/studio-core` *cannot* be removed are the kind of thing that saves the
next person a day.

The findings below are therefore not "this is broken." They are the seams that
will fail as this scales past one user with a handful of invoices.

---

## Priority order

| # | Item | Why first |
| - | ---- | --------- |
| 1 | [S1](#s1--encrypted-fields-are-written-in-plaintext-by-two-write-paths) — close the plaintext write paths | Actively undermining a shipped security feature |
| 2 | [P1](#p1--getinvoiceworkspace-is-unbounded-and-it-is-the-apps-hot-path) — bound the workspace query | One line of risk away from OOM on a real dataset |
| 3 | [P2](#p2--session-is-resolved-45-times-per-page-render) — `cache()` on `getSession` | Smallest change with the largest measurable win |
| 4 | [S3](#s3--rate-limiter-has-a-check-then-act-race-defeating-its-stated-purpose) — atomic rate limiter | The guard does not hold under the load it was built for |
| 5 | [S2](#s2--backup-exports-decrypt-to-plaintext-on-disk) — decide and document backup plaintext | Cheap to decide now, expensive to change after users hold backups |

Separately, [R1](#r1--cache-export-costs-111s-and-runs-after-the-image-is-already-published)
(release pipeline) is a one-line config change worth ~85s per release and
carries no risk — worth taking whenever someone next touches `publish.yml`.

[S4](#s4--csrf-origin-check-keys-off-header-presence-not-actual-credential-type)
and the feature work can follow normally.

---

## Security

### S1 — Encrypted fields are written in plaintext by two write paths

**Severity: high.** `packages/db/src/field-encryption.ts:6-11` states the design
intent exactly right: call-site crypto leaks when one forgotten query writes
plaintext into a column everything else believes is encrypted. That has already
happened, in two places.

- `apps/web/src/app/actions.ts:168` — `createBankAccount` uses `getPrisma()`
  (the plain client), writing `accountNumber`, `iban`, `clabe`, `swift`,
  `routingNumber`, `accountHolderName` and `accountHolderAddress` as cleartext.
- `apps/web/src/lib/backup.ts:392` — `importWorkspace` likewise uses
  `getPrisma()`, so every restored bank account lands in plaintext. Worse than
  the first, because it is a bulk write.

Meanwhile `createWorkspaceFromOnboarding` (`apps/web/src/app/actions.ts:59`)
*does* use `getWorkspacePrisma()`. The same table is written encrypted down one
path and plaintext down another.

Severity is bounded — not eliminated — by `backfillEncryptedFields` running at
each sign-in, which seals these rows on the owner's next login. But the window
is real, and a database dump taken inside it defeats the entire feature.

**Fix.** Make the plain client unreachable for these models. Either export
`getPrisma()` as an internal-only symbol and force all workspace writes through
`getWorkspacePrisma()`, or add a dev/test assertion inside the extension that
throws when a model listed in `ENCRYPTED_FIELDS` is written by an unextended
client. The declarative field list is the right design; it just needs the
escape hatch closed.

---

### S2 — Backup exports decrypt to plaintext on disk

**Severity: medium (design decision, undocumented).**
`apps/web/src/app/api/admin/backup/route.ts:37` correctly passes the
encrypted-aware client, so `backup.json` contains **decrypted** account
numbers, IBANs and tax IDs — in a file that lands in the user's Downloads
folder, gets synced to cloud storage, and gets attached to support threads.

This may well be deliberate: a backup you cannot restore without the app is not
a backup. But it is not stated anywhere, and it means at-rest encryption
protects the database while the documented backup path bypasses it.

**Fix.** State the decision explicitly in
`apps/docs/content/docs/data-classification.mdx`, and offer recovery-key-wrapped
export as an option. Every primitive needed already exists (`issueRecoveryKey`,
`wrap`/`unwrap` in `packages/crypto/src/key-hierarchy.ts`).

---

### S3 — Rate limiter has a check-then-act race, defeating its stated purpose

**Severity: medium.** `apps/web/src/lib/api/rate-limit.ts:32-63` does
`findUnique` → decide → `update`. Under concurrency, N simultaneous requests
all read `count < max` and all proceed.

The module's own docstring says the limiter exists because scrypt at 64 MB
against a 128 MB cap means "two concurrent calls exhaust the heap." A limiter
that only holds under *sequential* load does not defend against the one
scenario it was written for.

**Fix.** Collapse it to a single atomic statement:

```sql
INSERT INTO "RateLimit" (key, count, "lastRequest")
VALUES ($1, 1, $2)
ON CONFLICT (key) DO UPDATE
  SET count = CASE
        WHEN $2 - "RateLimit"."lastRequest" > $3 THEN 1
        ELSE "RateLimit".count + 1
      END,
      "lastRequest" = CASE
        WHEN $2 - "RateLimit"."lastRequest" > $3 THEN $2
        ELSE "RateLimit"."lastRequest"
      END
RETURNING count, "lastRequest";
```

One round trip, and correct under concurrency.

**Related nuance, worth correcting in the comment.** scrypt's memory is
allocated natively by OpenSSL, not in V8's old space, so
`NODE_OPTIONS=--max-old-space-size=128` (`Dockerfile`) does **not** bound it.
The real ceiling is the container memory limit. The comment in
`rate-limit.ts` is load-bearing for the sizing decision, so it should say so.

---

### S4 — CSRF origin check keys off header presence, not actual credential type

**Severity: low today, latent.** `isCredentialedByApiKey()` — duplicated in
`apps/web/src/app/api/v1/uploads/route.ts:18`,
`apps/web/src/app/api/v1/uploads/[id]/route.ts:18` and
`apps/web/src/app/api/v1/vault/route.ts:19` — returns true for *any*
`authorization` header. But `requireApiIdentity`
(`apps/web/src/lib/api/identity.ts:15`) only treats it as an API key when it
starts with `bearer `.

So `Authorization: Basic anything` plus a session cookie skips the same-origin
check entirely and then authenticates via cookie.

Not directly exploitable today: `Authorization` is not a CORS-safelisted
request header, so a cross-origin attempt triggers a preflight this app never
answers. But the protection rests on a browser invariant rather than on the
app's own logic, and the helper is copy-pasted three times.

**Fix.** Have `requireApiIdentity` return how it authenticated —
`{ userId, via: "apiKey" | "session" }` — and branch on that. This deletes
three duplicated helpers and makes the guard structurally correct rather than
incidentally correct.

---

### S5 — Reasoned tradeoffs, listed to keep them visible

These are documented decisions, not oversights.

- **CSP `script-src 'unsafe-inline'`** (`apps/web/src/lib/security-headers.ts:41`).
  The file already identifies the fix and notes that `apps/web/src/proxy.ts`
  now exists to carry a nonce. Worth scheduling.
- **No `secure` flag on the data-key cookie, no HSTS**
  (`packages/auth/src/data-key.ts:24`, `security-headers.ts:68`). Correct for
  plain-HTTP Umbrel. Consider setting `secure` *conditionally* on
  `x-forwarded-proto === "https"` rather than never — tunnel users gain the
  protection, local-HTTP users are unaffected.
- **API keys have no scopes.** One key grants full account access, including
  vault and uploads. See [F3](#features-worth-planning-for).
- **Vault key crosses the network in cleartext on HTTP**
  (`apps/web/src/app/api/v1/vault/route.ts:25-41`). Already documented in the
  code and surfaced in the UI. Same transport limitation as the two above.

---

## Performance

### P1 — `getInvoiceWorkspace` is unbounded, and it is the app's hot path

**Severity: high.** `apps/web/src/lib/invoice-workspace.ts:96-106` loads
**every** invoice for the user, each with `lineItems`, `userProfile`,
`bankAccount`, `clientCompany` and three revisions. The dashboard then renders
eight of them (`apps/web/src/app/(app)/dashboard/page.tsx:115`) and reduces the
rest in JavaScript to produce four totals.

At 1,000 invoices × 5 line items that is tens of thousands of rows hydrated
into Prisma objects per page load, on a 128 MB heap, with per-row AES-GCM
decryption on the joined bank accounts. This is the single biggest scaling risk
in the codebase, and it is on the first screen after login.

**Fix.** Add `take: RECENT_INVOICE_LIMIT` to the list query, and move the four
stats to a DB-side `groupBy`/`aggregate`. Postgres already carries
`@@index([userId])` and `@@index([status])`
(`packages/db/prisma/schema/invoicing.prisma:97-98`) to serve it.

---

### P2 — Session is resolved 4–5 times per page render

**Severity: medium.** There is no `cache()` wrapper on `getSession`
(`packages/auth/src/session.ts:28`) and no `session.cookieCache` in the
better-auth config (`packages/auth/src/auth.ts`).

A dashboard render performs, in order:

1. `requireSession()` in `apps/web/src/app/(app)/layout.tsx:18`
2. `getRecoveryKeyState()` in the same layout, line 19
3. `requireSession()` again in `dashboard/page.tsx:18`
4. `getSession()` via `getWorkspacePrisma()` in `lib/workspace-prisma.ts:19`
5. `getDataKey()` in the same function, line 22

Each is a real Postgres round trip for the same session row.

**Fix.** Wrap `getSession` in React's `cache()`. One line, removes roughly
three queries per render, and is safe because `cache()` is per-request scoped.
Then consider better-auth's `session.cookieCache` for a signed short-TTL cache
on top.

---

### P3 — Everything is `force-dynamic` (34 files)

**Severity: low.** The correct default for an authenticated app shell, but the
invoice detail and print path (`apps/web/src/app/(app)/invoices/[id]/page.tsx`)
renders the same document repeatedly and is a good candidate for explicit
caching keyed on the invoice's `updatedAt`.

---

## Features worth planning for

Ordered by what the platform will actually demand, not by novelty.

### F1 — Full-install backup, not per-admin backup

`/api/admin/backup` exports only the calling administrator's own rows
(`apps/web/src/app/api/admin/backup/route.ts:37`). On a multi-user install —
which `REQUIREMENTS.md` explicitly targets — there is no way to back up the
installation. For a self-hosted app that is the feature users assume exists
until the day they need it.

### F2 — Scheduled / automated backup

There is no scheduler in the app. The error-log prune works around this with
5% sampling on write (`apps/web/src/lib/error-log.ts:65`). Umbrel users expect
"back up nightly to this path." Together with F1 this is probably the highest-
value feature gap on the board.

### F3 — Scoped API keys

The `Apikey` model and the better-auth plugin are already wired
(`packages/db/prisma/schema/auth.prisma:101`, `packages/auth/src/auth.ts`).
Adding read/write and per-resource scopes *before* third-party integrations
exist is far cheaper than retrofitting after.

### F4 — Resolve the admin "set a password directly" feature

`TODO.md` flags this as unresolved and it is the right call to resolve it: it
orphans the keyset the same way a password reset does. The restore flow
(`/onboarding/restore-access`) catches the resulting state, so the honest
options are to keep it and rely on restore, or to remove it. Leaving it
undecided is the worst of the three.

### F5 — Recovery-key rotation in settings

Rotation exists mechanically — `issueRecoveryKey` replaces the recovery arm —
but there is no settings-level "generate a new recovery key" affordance for a
user who believes theirs has leaked.

### F6 — Passkeys

Currently deferred on transport grounds, which is reasonable. Revisit when
HTTPS-by-default is achievable.

---

## Release pipeline performance

Measured against run
[`30879678765`](https://github.com/chepetime/billow/actions/runs/30879678765)
(v0.1.42, successful): **8m 46s** wall clock. Four recent successful releases
ran 8m 23s – 9m 04s, so this run is representative.

### Where the time goes

Critical path, job by job:

| Job | Duration | Notes |
| --- | -------- | ----- |
| `tag` | 151s | `Verify the release candidate` alone is 119s |
| `publish / build` (amd64) | 295s | the critical leg; arm64 finished in 254s |
| `publish / merge` | 19s | |
| `publish / verify` | 43s | |
| `summary` | 3s | |
| job scheduling gaps | ~11s | |

Inside the amd64 Docker build (268s of that job's 295s):

| BuildKit step | Duration |
| ------------- | -------- |
| `#58 exporting cache to registry` | **111.4s** |
| `#46 [builder] pnpm --filter @billow/web build` | 92.1s |
| `#24 [deps] pnpm install` | 26.3s |
| `#30 [builder] COPY --from=deps node_modules` | 14.4s |
| `#56 exporting to image + pushing layers` | 12.3s |
| `#28 [migrator] npm install prisma` | 5.8s |

### R1 — Cache export costs 111s and runs *after* the image is already published

**Biggest single win. Expected saving: ~85s.**

`cache-to: type=registry,ref=...,mode=max`
(`.github/workflows/publish.yml:115`) pushes every intermediate layer of every
stage to GHCR. The log shows the image itself finished pushing at 05:12:23
(`#56`), and the job then spent a further **108 seconds** on `#58 exporting
cache to registry` before it could complete. That is 41% of the Docker build
spent on work that produces nothing the release needs.

**Fix.** Switch to GitHub's cache backend, which is co-located with the runner
instead of a round trip to GHCR. `ci.yml:` already uses `type=gha,mode=max` for
its docker job, so this is consistent rather than novel:

```yaml
cache-from: |
  type=gha,scope=${{ matrix.arch }}
  type=registry,ref=${{ env.IMAGE_NAME }}:buildcache-${{ matrix.arch }}
cache-to: type=gha,mode=max,scope=${{ matrix.arch }}
```

Keeping the registry entry in `cache-from` means a cold gha cache (evicted
after 7 days idle, 10 GB repo cap) still falls back to what is in GHCR rather
than building from zero. If you would rather stay entirely on registry cache,
`mode=min` cuts the export sharply — at the cost of no longer caching the
`deps` and `builder` stages, which is the cache you most want.

### R2 — The pnpm store cache mount is dead in CI

**Expected saving: ~15s per architecture.**

`Dockerfile:37` mounts a BuildKit cache at `/pnpm/store`. The build log shows
what that is actually worth in CI:

```
#24 9.011 Progress: resolved 972, reused 0, downloaded 218, added 12
```

`reused 0`. BuildKit `--mount=type=cache` directories are not exported by
either the registry or the gha cache backend, so the store is empty on every CI
run and all 972 packages are fetched fresh. The mount only helps local
rebuilds — worth saying so in the comment, which currently reads as though it
helps everywhere.

**Fix.** Split the dependency install into fetch-then-install, which is the
standard pnpm-in-Docker layout and fixes this properly:

```dockerfile
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch                      # depends on the lockfile alone
COPY package.json ./
COPY apps/web/package.json ./apps/web/package.json
# ... remaining manifests ...
RUN pnpm install --filter @billow/web... --frozen-lockfile --offline
```

`pnpm fetch` populates the store from `pnpm-lock.yaml` **without needing any
manifest**. Since a version-only release does not change the lockfile, that
expensive layer stays cached across releases and only the fast `--offline`
install re-runs.

That matters because of R3.

### R3 — Every release invalidates the dependency layer by construction

`release.yml:57-87` bumps the `version` field in the root `package.json` and
in all eight workspace manifests. `Dockerfile:26-35` copies every one of those
files into the `deps` stage immediately before `pnpm install`. So a
version-only change busts the dependency layer on *every single release*,
forcing the full install (26s) and invalidating the
`COPY --from=deps node_modules` that follows (14s).

This is not cheaply fixable head-on: `publish.yml:64-67` deliberately checks
out the tag so the image bakes the correct `NEXT_PUBLIC_APP_VERSION`, and that
decision was made for a good reason (it fixed images built from the pre-bump
commit). Passing the version as a build arg instead would trade one hard-won
guarantee for a performance gain.

**So treat R2 as the fix for R3.** Restructuring around `pnpm fetch` makes the
cold install cheap enough that invalidating it stops mattering, without
touching the checkout-the-tag invariant at all.

A smaller, independent cleanup: `packages/*/package.json` versions are never
consumed by anything — they are private and referenced as `workspace:*`, and
the diagnostics page reads `next`/`@prisma/client`/`better-auth` versions, not
Billow's. Bumping them is cosmetic. Restricting the bump to the root and
`apps/*` would reduce churn, though on its own it does not save the layer.

### R4 — `tag` re-verifies serially, with no turbo cache

**Expected saving: ~65s.**

`release.yml:93-98` runs `db:generate`, `lint`, `test:run` and `build` as four
sequential commands in one step: 119s of the job's 151s. Two problems:

1. **No turbo cache.** `ci.yml:44-50` caches `.turbo/cache`; `release.yml` does
   not. Every release recomputes from cold what CI just computed on nearly
   identical source.
2. **No parallelism.** `ci.yml` runs exactly these tasks as a three-way matrix.
   The release job runs them end to end.

**Fix.** Mirror what `ci.yml` already does — add the `.turbo/cache` restore
step, and either split verification into a matrix job that `tag` depends on, or
run the three tasks concurrently. Wall time should fall from ~119s to roughly
the longest single task.

If you want more, the stronger option is to stop re-verifying entirely and
instead gate on CI having passed for the parent commit — a version bump touches
only `version` fields and cannot plausibly break lint or tests. That trades a
safety net for ~110s. Worth doing only if release cadence makes the wait
painful; R1 and R4 get most of the way without giving anything up.

### Projected result

| Change | Saving |
| ------ | ------ |
| R1 — gha cache export | ~85s |
| R4 — parallel verify + turbo cache | ~65s |
| R2 — `pnpm fetch` layer split | ~15s |

**8m 46s → roughly 5m 20s**, with no reduction in what the pipeline actually
checks. Dropping the `tag` re-verification in favour of a CI-green gate would
take it under 4 minutes, at a real cost in safety.

Note that `verify` (43s) is not on the cut list. It boots the published image,
confirms both architectures resolve, and asserts the baked version — the checks
that were once done by hand and once skipped, leaving the store pointing at a
missing tag. It earns its place.

---

## Process note

The discipline of recording *why* in comments is the most valuable thing this
repository has. `TODO.md` already warns that three items were marked todo while
already implemented, and were nearly rebuilt as a result.

S1 is the same failure in the other direction: a design documented as airtight,
with two live bypasses. Both directions have the same remedy — a periodic
grep-the-invariant pass, where for each documented guarantee someone verifies
no path skips it. That is worth adding to the release checklist in
`.claude/skills/release/SKILL.md`, or running as a standing review task.
