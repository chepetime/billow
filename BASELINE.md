# Billow baseline (platform layer)

This document tracks the **platform** layer only — accounts, API, encryption,
backups, image, release pipeline — the parts that would be needed regardless of
domain. It is deliberately domain-free, which is why the invoicing product does
not appear here.

Billow itself is an invoice manager, not a starter kit; see `README.md` and
`REQUIREMENTS.md`. This file survives as the platform checklist because that
layer still has to be kept honest on its own terms.

The invoicing domain checklist lives separately in [`progress.txt`](progress.txt).

Legend: `[x]` done · `[ ]` todo · `[~]` partially done

---

## Auth & accounts

- [x] Admin role: first account administers the installation; users list with
      role, ban, session revocation, and removal

- [x] Email + password sign-up / sign-in (BetterAuth + Prisma adapter)
- [x] First-user-only registration (`databaseHooks.user.create.before` guard)
- [x] Session-gated route group + optimistic middleware redirect
- [x] Username as an alternative login identifier
- [x] Change email (direct update; no mail transport in this app)
- [x] Change password (revokes other sessions)
- [x] Two-factor auth (TOTP, QR enrolment, single-use backup codes)
- [x] Origin handling that works behind any proxy/host (no pinned domain)
- [x] Password reset no longer logs a usable URL; administrators can set a
      password directly (self-service still needs SMTP)
- [x] **Outbound email** — `@billow/email` (Resend + react-email), credentials
      set by an admin in Settings → Administration and stored AES-256-GCM
      encrypted, test-send button, provider seam for SMTP later
- [x] **Self-service password reset** — `/forgot-password` and
      `/reset-password`, delivery through `@billow/email`. Gated on a verified
      email provider: hidden (and the request page 404s) until a test message
      has actually been delivered, and hidden again if a live send later fails
      Needs either a real mail transport or a "copy this link" admin surface.
- [x] **Session management UI** — active sessions on /settings/security with
      device/IP/expiry, individual revocation and "sign out everywhere else".
      The current session is listed but cannot revoke itself.
- [x] **Account deletion** (`auth.api.deleteUser`) with a confirmation step

- [ ] Email verification (only if a mail transport is ever added)
- [x] Admin role, admin panel, and server-side authorization for installation settings
- [ ] Multi-user support: invitations, invitations, closing or reopening
      registration from the UI (today it is strictly first-user-only)

## API

- [x] Personal API keys (`@better-auth/api-key`): create, list, revoke in settings
- [x] `GET /api/v1/me` — accepts `x-api-key` or `Authorization: Bearer`, or a session
- [x] **Public API docs** — generate `/api/v1/openapi.json` from the zod schemas
      via `z.toJSONSchema()` and render it at `/docs/api` with a locally bundled
      `@scalar/api-reference-react` (no CDN, works offline)
- [x] Enable BetterAuth's built-in `openAPI()` plugin so auth endpoints are
      documented too
- [x] Shared route helpers: `lib/api/identity.ts` (`requireApiIdentity`) and
      `lib/api/respond.ts` (consistent `{ error }` shape, zod 400s) — the auth
      logic is currently inlined in the one route
- [ ] Documented conventions: versioning, pagination, error codes
- [ ] Per-key rate limiting (the api-key plugin supports it; not yet configured)
- [ ] Key expiry / last-used surfacing in the UI

## UI & UX

- [x] Minimal landing page with sign-in / sign-up (sign-up hidden once closed)
- [x] Dashboard shell + account settings
- [x] **Form validation** — zod schemas + `Field` + react-hook-form wired into
      sign-in, sign-up, and two-factor. Still to migrate: `account-form`,
      `two-factor-section`, `api-keys-section`
- [x] Theming — `next-themes` applies the existing palette, with persisted
      light/dark/system controls on authenticated and public entry pages.
- [ ] **i18n** — `next-intl@4`, cookie-based (`NEXT_LOCALE`, no URL prefix),
      messages in `messages/{en,es}.json`, language picker in settings
- [x] Toast / notification system (success + error feedback is inline-only today)
- [ ] Loading and empty states pass
- [ ] Accessibility pass (keyboard nav, focus rings, screen-reader labels)
- [ ] Mobile layout pass

## Storage and files

- [x] **Persistent volume for the app** — `${APP_DATA_DIR}/uploads:/data/uploads`,
      reported in diagnostics (including whether it is a real mount). The
      container runs as uid 1000 to match the owner Umbrel creates app data
      with, and the store repo commits an empty `uploads/` so the host path
      exists with that owner before the container starts. The image declares
      `USER node`, so it never starts as root and needs no su-exec: an
      unwritable mount is reported at boot instead of being chowned away.
- [x] Upload model, storage abstraction, size/MIME limits with magic-byte
      sniffing, generated filenames, per-user quotas, auth-checked serving
- [x] Backup and restore cover files as well as the database (format v2, a
      gzipped tar; see Operations)

## Operations

- [x] `/health` page + `/api/health` JSON (version, uptime, memory, DB, auth,
      session, recent errors)
- [x] Persistent error log in the database, surfaced through the API
- [x] Migrations run automatically at container start, with retry
- [x] Transient DB connection retries; auth failures fail fast
- [x] V8 old space capped (`--max-old-space-size=128`; ~60 MiB idle) — the flag
      bounds the old generation, not the process: scrypt's 64 MB comes from
      OpenSSL and file buffers from Node, both outside it. What bounds RSS is
      the container memory limit.
- [x] **Backup / restore** — admin export/import of workspace data, one
      transaction, ownership forced to the importer, ids remapped
- [x] **Backup covers uploaded files** — the export is a gzipped tar
      (`backup.json` + `files/NNNN`) rather than bare JSON, streamed so peak
      memory is one file: the 100 MB per-account upload quota does not fit in
      the 128 MB heap cap if base64-inlined. Restores verify size and checksum
      against the manifest, re-sniff the type, regenerate storage keys scoped
      to the importing user, and report every skipped file. Version 1 exports
      (JSON, no files) still restore.
- [x] **Encrypted backups are opt-in, and the default is documented** — an
      export decrypts to plaintext on purpose (a backup only its own install
      can read is not a backup), which the UI and the data-classification docs
      now say out loud. Sending the account's recovery key seals every archive
      entry under a wrapped content key instead; export verifies that key
      against the account first, restore cannot and does not.
- [ ] SMTP provider alongside Resend — Resend is a hosted API needing outbound
      internet and an account, which not every self-hosted install wants. The
      seam is in place (`packages/email/src/provider.ts`); this is a new file
      plus a branch, with no change to callers or the admin UI
- [ ] Background jobs (log retention, upload cleanup, key expiry)
- [ ] Audit log: who changed what, distinct from the error log
- [ ] Structured logging (currently `console.*`)
- [x] Log retention — `ErrorLog` is capped at 500 rows / 30 days, pruned
      opportunistically on ~5% of writes rather than by a scheduler (this app
      has none). Pruning failures never fail the write they ride on.
- [ ] Graceful degradation review: every page should render when the DB is down
      (landing and `/health` already do)

## Security

- [x] Database password is per-installation (`${APP_SEED}`) rather than a value
      published in the store repository

- [x] Secrets from env, never hardcoded (`BETTER_AUTH_SECRET` ← `${APP_SEED}`)
- [x] Bank/account numbers masked outside explicit detail views
- [x] API keys stored hashed, shown once
- [x] **CSRF posture** — `trustedOrigins` derives from the served host
      (`x-forwarded-host`/`proto`), never the request `Origin`, with
      `BILLOW_TRUSTED_ORIGINS` as an escape hatch
- [x] **Security headers / CSP** — `apps/web/src/lib/security-headers.ts`,
      applied to every route from `next.config.ts`. CSP keeps `'unsafe-inline'`
      for scripts and styles (next-themes' pre-paint script, Next's bootstrap,
      Scalar's runtime styles) with a note on tightening to a nonce later.
      `Strict-Transport-Security` is deliberately omitted — this app is served
      over plain HTTP, and a cached HSTS pin would lock users out if a tunnel
      went away.
- [x] **Rate limiting on auth endpoints** — `rateLimit` in `packages/auth`,
      pinned `enabled: true` so it does not depend on `NODE_ENV`. 100/60s
      generally, with `customRules` at 5/60s on sign-in (email and username),
      all three two-factor verify paths, and password-reset requests. Storage
      is in-memory: correct for a single container, but counters reset on
      restart, which briefly re-opens the window around a deploy.
- [x] Dependency audit in CI (`pnpm audit`)

## Release & packaging

- [x] Tag-driven releases (`v*` → GHCR); pushes to `main` only run CI
- [x] Verify the GHCR manifest exists before bumping the store
- [x] Parallel CI (lint/test/build matrix + migrations) with checksum-keyed caches
- [x] Local CI runs via `act`
- [x] Self-hosted app icon in the store repo
- [x] **Gallery images** — still the same placeholder imgur URL three times.
      Best fix: real screenshots of the running app (landing, dashboard, settings)
- [ ] `CHANGELOG.md` generated from tags
- [x] **Multi-arch images (`linux/amd64` + `linux/arm64`)** — one manifest list,
      so the digest pinned in the store repo covers both. `verify` asserts both
      architectures are present rather than just that the tag resolves, since
      an amd64-only manifest passes every other check on an amd64 runner.
- [x] **`output: "standalone"`** — 326 MiB → 140 MiB compressed (1.9 GB → 492 MB
      on disk). The runner ships the traced bundle instead of
      `pnpm install --prod`, so it contains no pnpm and no `next` CLI. No
      `outputFileTracingIncludes` was needed: Prisma 7's `prisma-client`
      generator emits TypeScript and `@prisma/adapter-pg` routes queries
      through `pg`, so there is no query-engine binary to trace.
- [ ] **Shrink the migration toolchain (~225 MB, now the largest single thing
      in the image)** — the Prisma CLI is only there so `migrate deploy` can run
      at boot, and it cannot be trimmed further: the CLI bundle eagerly requires
      `@prisma/studio-core` (~42 MB) and `@prisma/dev` (~18 MB), neither of
      which `migrate deploy` uses. Options are an init container that carries
      the CLI, or applying migrations directly through `pg` and owning the
      `_prisma_migrations` bookkeeping.
- [ ] Document required env vars for anyone reusing this as a template

## Developer experience

- [x] `pnpm run dev:local` (Postgres in Docker + Next on the host, seeded)
- [x] Unit tests with Vitest
- [x] **End-to-end tests** (`packages/e2e`, Playwright): first-run registration,
      sign-in by email and username, session protection, API key →
      `/api/v1/me`, upload round-trip, admin visibility, cross-account
      isolation. Nightly against the production image via `e2e.yml`
- [x] 2FA enrolment coverage in the e2e suite — enrols, signs in with a
      generated TOTP code, then turns 2FA back off. Lives in
      `auth-flows.spec.ts` because enabling 2FA changes every password
      sign-in and only tests within a file run serially.
- [ ] **Domain docs**: `CONTEXT.md` (glossary) + `docs/adr/` at the repo root,
      per `docs/agents/domain.md`. Neither exists yet — they are meant to be
      created lazily by `/domain-modeling` as terms and decisions actually get
      resolved, so this is a marker, not a prompt to write them upfront
- [x] `db:reset` command for a clean local database (`prisma migrate reset
      --force`; Prisma 7 has no `--skip-generate`)
- [ ] Extract the platform layer into a reusable template once the invoicing
      domain lands on top (the long-term goal implied by all of the above)

---

## Done: extract `@billow/auth`

Auth is the largest security surface here, so it should be auditable in
isolation rather than read out of `apps/web/src/lib`. Roughly 340 lines across
eight cohesive modules, depending only on `@billow/db` and `error-log` — no
circular dependency.

- [x] `packages/auth` with three entry points, mirroring how `@billow/db`
      separates server from client:
      `@billow/auth` (server: the auth instance, `requireSession`,
      `requireAdmin`), `@billow/auth/client` (`"use client"`: `authClient`),
      and `@billow/auth/env` (pure: `getAuthEnv`, `resolveTrustedOrigins`,
      `canRegister`). The pure entry is the audit win — the security-critical
      logic becomes testable without Next or a database.
- [x] Split the Prisma schema into a folder so the seven auth-owned models
      live in their own file. Do this in the same change: the package boundary
      is otherwise code-only, and an auditor still has to read `packages/db`
      for the schema.
- [x] Update the Dockerfile's manifest `COPY` list in the same commit. The
      image installs with `--filter @billow/web...`, so a new package the web
      app depends on must be copied or the build fails. CI's `docker image`
      job catches this.

Around 37 files import these modules today, so the diff is wide but mechanical.
No image release is needed for the refactor itself; it ships with whatever
feature release follows.

## Suggested order

1. **i18n** — the last unfinished phase of the platform plan, and the largest
   remaining user-visible gap.
2. Audit log and structured logging — both currently absent, and the pair that
   makes an incident reconstructable.
3. Shrink the migration toolchain (~225 MB) — needs an init container or
   owning the `_prisma_migrations` bookkeeping; a real architectural choice,
   not a cleanup.
4. SMTP provider alongside Resend; API conventions (pagination, error codes,
   per-key rate limiting, key expiry in the UI).
5. `CHANGELOG.md`, loading/empty states, a11y and mobile passes.
6. Passkeys once HTTPS is in place.

Before trusting a checkbox here, grep for it. Three items in this file were
marked todo while already implemented — security headers, auth rate limiting,
and error-log retention — and were nearly rebuilt from scratch as a result.
