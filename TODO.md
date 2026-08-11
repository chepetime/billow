# TODO

Pending work, most valuable first. `BASELINE.md` is the full platform
checklist and stays the source of truth for what is done — **grep before
trusting a checkbox in either file.** Three items there were marked todo while
already implemented (security headers, auth rate limiting, error-log
retention) and were nearly rebuilt from scratch as a result.

Shipped through **0.1.34** (experimental vault). Data classification (docs +
the `data-classification` skill) shipped and is no longer listed here.

---

## 1. Encrypt personal data so a DB dump is useless

**Decided:** recovery key generated at signup (the Bitwarden model).

The honest limit, which should be stated in the docs rather than implied
away: in self-hosted software the admin controls the runtime, so an admin who
*modifies the app* can capture the key when the user signs in. This defends
against a stolen dump, a leaked backup, a volume snapshot, and casual
snooping — not against a motivated operator. "The database is useless without
the user", not "the admin can never see it".

**Built (`@billow/crypto`, 21 tests) — do not rebuild:** the whole key
lifecycle. `createUserKeyset` / `unlockWithPassword` / `unlockWithRecoveryKey` /
`changePassword` / `resetPasswordWithRecoveryKey` / `beginSession` /
`resumeSession`. Persisted by `UserKeyset`, `UserOnboarding` and
`Session.dataKeyWrappedBySessionKey` (migration
`20260803174343_add_user_key_hierarchy`, additive). Documented under "Key
hierarchy" in `apps/docs/content/docs/data-classification.mdx`.

Session custody was the open question and is **decided**: the data key is
re-wrapped per session under a random 256-bit key carried in an httpOnly
cookie, with the wrap on the session row. That is what lets a *server
component* decrypt — a client-held key would have forced every encrypted read
into a client fetch. It is random, not derived: this path runs on every
request, and scrypt there would cost tens of ms per render.

**Also built:** the better-auth wiring. An `after` hook on `/sign-up/email`,
`/sign-in/{email,username}`, `/two-factor/verify-*` and `/change-password`
mints, unwraps and re-wraps the key; `getDataKey(userId, sessionId)` is
exported from `@billow/auth` for server components. Verified against a running
app, not only in unit tests.

Two-factor needed its own path: the password arrives at `/sign-in/email` but no
session exists until `/two-factor/verify-*`, so the key is parked in a
ten-minute `Verification` row whose unwrapping key rides in a separate cookie.

Still to do, in order:

- ~~**Password reset orphans the keyset**~~ — handled by a restore flow rather
  than by patching each cause. `/onboarding/restore-access` takes the recovery
  key plus the current password, re-wraps, re-opens the session and clears
  `recoveryKeySavedAt` so a spent key is rotated. Catches an admin-set password
  too, since it keys off the resulting state rather than the endpoint.
  Superseded note:
  `/reset-password` has no current password, so the data key cannot be
  re-wrapped and the account keeps a keyset sealed under a password nobody
  knows. Today that only costs the (empty) encrypted set, but it **must** be
  resolved before the Prisma extension lands or a reset becomes silent data
  loss. Everything it needs now exists: `resetPasswordWithRecoveryKey` is built
  and tested, and onboarding guarantees a recovery key to demand.
- ~~**Onboarding UI**~~ — built. `/onboarding/recovery-key` reveals the key
  once, confirms it by unwrapping the data key with it, re-issues until
  confirmed, and stamps `UserOnboarding`. Gating is derived from the keyset's
  recovery arm rather than the saved flag, so a keyset without one is caught
  however the bookkeeping looks. Accounts with no keyset are backfilled at
  sign-in, the only moment their password is in scope.
- **The admin "set a password directly" feature** has the same orphaning
  problem as a reset. Decide whether it survives.
- **Prisma client extension** + the declarative field list — the seam that
  makes crypto impossible to forget rather than merely available. Call-site
  crypto is where these designs leak: one forgotten query writes plaintext into
  an "encrypted" column and nothing notices.
- Migration of existing rows is cheap — `BankAccount`, `UserProfile` and
  `ClientCompany` are 24 kB each in production.

### Scope: build the mechanism, not the field list

This repo is the blueprint. The invoicing models are a placeholder for whatever
domain gets built on top, so **do not spend time deciding which invoice fields
are encrypted** — that is the eventual app's call, not the platform's.

What the platform owes is a mechanism that makes the choice cheap and hard to
get wrong:

- A **declarative list** of encrypted fields in one reviewable place, applied
  through a Prisma client extension. Adding a field to the list should be the
  entire change.
- The classification doc and its skill are what keep that list honest.
- Prove it on fields that already exist and are unambiguously sensitive —
  `BankAccount.accountNumber` / `iban` / `clabe` / `swift` / `routingNumber` /
  `institutionNumber` / `transitNumber` / `accountHolderName` /
  `accountHolderAddress`, and `UserProfile.taxId` / `address`.

Structural constraints that hold for any domain, and belong in the docs:

- Cannot be encrypted: anything needed *before* a key exists (`user.email`,
  `username`), anything under a unique constraint or used for ordering
  (`invoiceNumber`), foreign keys, timestamps, and installation config.
- Encrypted columns are unsearchable and unsortable in SQL, and a list view
  cannot render an encrypted column without the user's key. That tradeoff is
  the thing a downstream app needs stated plainly so it can choose.

Previously logged here as an open product question — whether invoice amounts
and client names should be encrypted — which is moot until there is a real
invoicing app to ask it of.

### Onboarding state (needed by the recovery key)

A recovery key is worthless if the user never saved it. "Generated one" and
"confirmed they saved it" are separate facts, because only the second means
anything.

The `UserOnboarding` model exists — 1:1 on `userId`, nullable
`recoveryKeyGeneratedAt` / `recoveryKeySavedAt`, timestamps rather than
booleans so "when" is answerable too. **Nothing writes to it yet.** What
remains is the flow:

- Confirmation must require re-entering part of the key, not ticking a box. A
  checkbox records that they clicked, not that they have it.
- If the flow turns out to need more than these two facts, add columns rather
  than a JSON blob of flags — a blob escapes both the schema and the
  classification doc.

### Knock-on effects to handle

- Password reset must warn hard, and the recovery key must be the documented
  way through it.
- The admin "set a password directly" feature would orphan a user's encrypted
  data — decide whether it survives.
- Encrypted columns are unsearchable and unsortable in SQL.
- ~~Backup export runs as the user, so it writes plaintext — intended, but say
  so in the docs.~~ **Done.** Stated under "Backups leave the encryption
  boundary" in the data-classification docs and in the export UI, and an opt-in
  recovery-key-sealed export now exists beside the plaintext one
  (`packages/crypto/src/backup-envelope.ts`).

## 2. Finish i18n

Foundation is in (cookie + `Accept-Language`, stored choice wins, picker under
Settings → Account, 9 negotiation tests). Theme already followed the OS and
needed no change.

- Extract the rest of the UI. Only auth, two-factor and the sessions list are
  translated; everything else is English literals.
- Server components use `getTranslations`, client ones `useTranslations`.

## 3. From the 2026-08-03 audit

Confirmed by reading the code; not yet fixed.

- **Rate-limit the scrypt routes.** better-auth's limiter only covers
  `/api/auth/*`. `/api/v1/vault` and `/api/v1/recovery-key/*` run scrypt at
  N=32768 per request, so an authenticated caller can exhaust a single-process
  container with a 128 MB heap. Fix together with the persisted `rateLimit`
  model, which also closes the redeploy window in §6.
- **Account deletion leaves uploaded files on disk.** Rows cascade, nothing
  calls `deleteObject`. Keys are `<userId>/<uuid>`, so a recursive delete of
  the user directory is enough. Retention problem, not just disk.
- **`/api/admin/restore` buffers the whole body before any size check.**
  `MAX_ARCHIVE_BYTES` only bounds the decompressed output. The uploads route
  already does the content-length pre-check — copy it and stream the gunzip.
- **Upload downloads buffer fully into memory.** 10 MB x concurrency against a
  128 MB heap; the backup route already streams.
- **`getInvoiceWorkspace` loads everything to render eight rows** — all line
  items, three revisions each, totals in JS, per request. Needs `take`,
  `groupBy` for stats, no revisions.
- **`/api/admin/backup` is admin-gated but exports only the caller's data**, so
  non-admins cannot export their own and admins cannot back up the install.
- **Data-key cookie has no `maxAge`**, so it dies with the browser while the
  session cookie persists — reopen and you are signed in with no data key.
  Becomes a support burden the moment field encryption ships.
- **No session cookie cache.** Every `getSession()` is a round-trip; the
  `(app)` layout adds `getRecoveryKeyState` on every navigation.
- **API keys have no scope.** `Apikey.permissions` exists and is never read.
- **CSP still needs `unsafe-inline`.** `src/proxy.ts` now exists, so a
  per-request nonce is a small change rather than a new mechanism.

## 4. Operations gaps

- **Audit log** — who changed what, distinct from the error log.
- **Structured logging** — currently `console.*`.
- Both are absent, and together they are what makes an incident
  reconstructable.

## 5. Shrink the image (~225 MB of 495 MB)

The Prisma CLI ships purely so `migrate deploy` can run at boot. It cannot be
trimmed further: the CLI bundle eagerly requires `@prisma/studio-core`
(~42 MB) and `@prisma/dev` (~18 MB) even though `migrate deploy` uses
neither — removing either fails instantly with MODULE_NOT_FOUND. Only
`mysql2`, `postgres` and `typescript` were removable.

Two real options, both architectural: an init container that carries the CLI,
or applying migrations through `pg` and owning the `_prisma_migrations`
bookkeeping ourselves.

## 6. Smaller, well-scoped

- Rate-limit counters are in-memory, so they reset on every deploy and briefly
  reopen the brute-force window. Needs a `rateLimit` model + migration.
- SMTP provider alongside Resend — the seam exists at
  `packages/email/src/provider.ts`; a new file and a branch, no caller changes.
- API conventions: pagination, error codes, per-key rate limiting, key expiry
  and last-used in the UI.
- `CHANGELOG.md` generated from tags.
- Loading and empty states; accessibility pass; mobile pass.
- Graceful degradation review — every page should render when the DB is down
  (landing and `/health` already do).
- Passkeys, once the app is reached over HTTPS. WebAuthn needs a secure
  context and Umbrel serves plain HTTP.

## 7. Not code

- Extract the platform layer into a reusable template — the long-term goal
  behind all of the above. The invoicing domain is still in the schema, which
  is why the repo is not honestly "boilerplate" yet.

---

## Traps worth remembering

- **Releases:** `.claude/skills/release/SKILL.md` is the procedure. The store
  update is manual after every release, and a store change that edits only
  `docker-compose.yml` never shows as an update — Umbrel compares
  `umbrel-app.yml`'s version.
- **Multi-arch:** do not collapse `publish.yml` back to one job with
  `platforms:` and QEMU. Emulated arm64 dies partway through `next build`
  with `SIGILL`. Native runners only.
- **Release ordering:** `release.yml` commits its version bump to `main`, so a
  local branch will need a rebase before the next push. Confirm the work is in
  `origin/main` *before* triggering, or the tag builds without it.
- **Standalone output:** `outputFileTracingRoot` must point at the workspace
  root. Without it Next infers `apps/web`, drops hoisted dependencies, builds
  fine, and dies at runtime on the first import.
