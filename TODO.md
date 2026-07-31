# TODO

Pending work, most valuable first. `BASELINE.md` is the full platform
checklist and stays the source of truth for what is done — **grep before
trusting a checkbox in either file.** Three items there were marked todo while
already implemented (security headers, auth rate limiting, error-log
retention) and were nearly rebuilt from scratch as a result.

Shipped through **0.1.33** (i18n foundation). Both repos pushed, working tree
clean.

---

## 1. Data classification: docs + a Claude skill

Started, not written. The goal is that "which fields are sensitive" lives
somewhere reviewable instead of dying in a code comment.

- Classify every model in `packages/db/prisma/schema/` (17 models across
  `auth.prisma`, `invoicing.prisma`, `platform.prisma`, `base.prisma`) as
  public / internal / sensitive, with the reason, as a page in `apps/docs`
  (`content/docs/*.mdx`, ordered by `content/docs/meta.json`).
- Add a Claude skill so a new model or field cannot be added without being
  classified — this is the control that stops the list rotting.

Prerequisite for §2: the classification *is* the encryption boundary.

## 2. Encrypt personal data so a DB dump is useless

**Decided:** recovery key generated at signup (the Bitwarden model).

The honest limit, which should be stated in the docs rather than implied
away: in self-hosted software the admin controls the runtime, so an admin who
*modifies the app* can capture the key when the user signs in. This defends
against a stolen dump, a leaked backup, a volume snapshot, and casual
snooping — not against a motivated operator. "The database is useless without
the user", not "the admin can never see it".

- Key hierarchy: per-user data key (DEK) wrapped by a key derived from the
  password (KEK), plus a second wrap under the recovery key. A password
  *change* then re-wraps the DEK instead of re-encrypting every row.
- The DEK only exists while signed in — never at rest server-side.
- Implement through a **Prisma client extension**, not encrypt/decrypt at each
  call site. Call-site crypto is where these designs leak: one forgotten query
  writes plaintext into an "encrypted" column and nothing notices.
- `packages/email/src/crypto.ts` already does AES-256-GCM + HKDF and is the
  precedent to follow.
- Migration is cheap — `BankAccount`, `UserProfile` and `ClientCompany` are
  24 kB each in production. The risk is entirely in the key design.

### Open question, blocking the field list

Must stay plaintext (needed before a key exists, or for constraints):
`user.email`, `username`, foreign keys, timestamps, `invoiceNumber`, and all
installation config.

Clearly sensitive: `BankAccount.accountNumber` / `iban` / `clabe` / `swift` /
`routingNumber` / `institutionNumber` / `transitNumber` /
`accountHolderName` / `accountHolderAddress`, `UserProfile.taxId` /
`address`.

**Undecided: invoice amounts and client names.** Leaving them plaintext still
tells an admin *who you bill and how much*, which is arguably as sensitive as
an account number. Encrypting them means list views cannot render without the
user's key. This is a product decision, not a technical one.

### Onboarding state (needed by the recovery key)

A recovery key is worthless if the user never saved it, and there is currently
nothing that records whether they did. Track per-user onboarding state —
starting with "generated a recovery key" and "confirmed they saved it" as
separate facts, because generating one and writing it down are different
events and only the second means anything.

Design notes:

- Prefer a `UserOnboarding` model keyed 1:1 on `userId` with explicit nullable
  `DateTime` columns (`recoveryKeyGeneratedAt`, `recoveryKeySavedAt`) over
  booleans. A timestamp answers "did they" *and* "when", and a JSON blob of
  flags would escape the schema and the classification doc.
- Confirmation should require the user to re-enter part of the key, not just
  tick a box. A checkbox records that they clicked, not that they have it.
- Build it **with** the key hierarchy, not before: what is worth recording
  depends on what the flow ends up being, and a table shipped early will be
  migrated immediately.
- Classify it in `apps/docs/content/docs/data-classification.mdx` when added —
  it is internal, not sensitive, and holds no key material.

### Knock-on effects to handle

- Password reset must warn hard, and the recovery key must be the documented
  way through it.
- The admin "set a password directly" feature would orphan a user's encrypted
  data — decide whether it survives.
- Encrypted columns are unsearchable and unsortable in SQL.
- Backup export runs as the user, so it writes plaintext — intended, but say
  so in the docs.

## 3. Finish i18n

Foundation is in (cookie + `Accept-Language`, stored choice wins, picker under
Settings → Account, 9 negotiation tests). Theme already followed the OS and
needed no change.

- Extract the rest of the UI. Only auth, two-factor and the sessions list are
  translated; everything else is English literals.
- Server components use `getTranslations`, client ones `useTranslations`.

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

- GitHub repo description and topics were drafted but never applied.
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
