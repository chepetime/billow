# Billow baseline (self-hosted app starter)

Billow has become, in practice, a **base setup for self-hosted Umbrel apps**.
This document tracks the *platform* layer only — everything a self-hosted app
needs regardless of its domain.

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
- [ ] **Self-service password reset UI** — delivery is wired
      (`sendResetPassword` → `@billow/email`); still needs the request form and
      the `/reset-password/<token>` page
      Needs either a real mail transport or a "copy this link" admin surface.
- [ ] **Session management UI** — list active sessions and revoke individually
      (`auth.api.listSessions` / `revokeSession` already exist)
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

- [x] **Persistent volume for the app** — `${APP_DATA_DIR}/uploads`, with
      ownership fixed at boot before privileges are dropped, and reported in
      diagnostics (including whether it is a real mount) — only Postgres has one today, so
      anything written to the container filesystem is lost on update. This is
      the prerequisite for uploads: `${APP_DATA_DIR}/uploads:/data/uploads`,
      writable by uid 1001.
- [ ] Upload model, storage abstraction, size/MIME limits with magic-byte
      sniffing, generated filenames, per-user quotas, auth-checked serving
- [ ] Backup and restore must cover files as well as the database

## Operations

- [x] `/health` page + `/api/health` JSON (version, uptime, memory, DB, auth,
      session, recent errors)
- [x] Persistent error log in the database, surfaced through the API
- [x] Migrations run automatically at container start, with retry
- [x] Transient DB connection retries; auth failures fail fast
- [x] Memory capped (`--max-old-space-size=128`; ~60 MiB idle)
- [x] **Backup / restore** — admin export/import of workspace data, one
      transaction, ownership forced to the importer, ids remapped
- [ ] Backup should also cover uploaded files once uploads exist — the largest gap for self-hosting: one-click export
      and restore of the database plus uploads
- [ ] SMTP provider alongside Resend — Resend is a hosted API needing outbound
      internet and an account, which not every self-hosted install wants. The
      seam is in place (`packages/email/src/provider.ts`); this is a new file
      plus a branch, with no change to callers or the admin UI
- [ ] Background jobs (log retention, upload cleanup, key expiry)
- [ ] Audit log: who changed what, distinct from the error log
- [ ] Structured logging (currently `console.*`)
- [ ] Log retention — `ErrorLog` grows unbounded; add pruning or a cap
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
- [ ] ~~Revisit CSRF posture~~ — `trustedOrigins` trusts the request `Origin`,
      which makes the check tautological. **Now fixable**: production
      diagnostics confirmed `x-forwarded-host` and `x-forwarded-proto` are
      present through *both* Umbrel's app_proxy and the Cloudflare tunnel, so
      the origin can be derived from the served host instead. The original
      premise (that Umbrel strips these) was wrong.
- [ ] Security headers / CSP
- [ ] Rate limiting on auth endpoints (brute-force protection)
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
- [ ] Multi-arch images (`linux/arm64`) if a non-amd64 Umbrel is ever targeted
- [ ] Document required env vars for anyone reusing this as a template

## Developer experience

- [x] `pnpm run dev:local` (Postgres in Docker + Next on the host, seeded)
- [x] Unit tests with Vitest
- [x] **End-to-end tests** (`packages/e2e`, Playwright): first-run registration,
      sign-in by email and username, session protection, API key →
      `/api/v1/me`, upload round-trip, admin visibility, cross-account
      isolation. Nightly against the production image via `e2e.yml`
- [ ] 2FA enrolment coverage in the e2e suite (the one flow still untested)
- [ ] **Domain docs**: `CONTEXT.md` (glossary) + `docs/adr/` at the repo root,
      per `docs/agents/domain.md`. Neither exists yet — they are meant to be
      created lazily by `/domain-modeling` as terms and decisions actually get
      resolved, so this is a marker, not a prompt to write them upfront
- [ ] `db:reset` command for a clean local database
- [ ] Extract the platform layer into a reusable template once the invoicing
      domain lands on top (the long-term goal implied by all of the above)

---

## Planned refactor: extract `@billow/auth`

Auth is the largest security surface here, so it should be auditable in
isolation rather than read out of `apps/web/src/lib`. Roughly 340 lines across
eight cohesive modules, depending only on `@billow/db` and `error-log` — no
circular dependency.

- [ ] `packages/auth` with three entry points, mirroring how `@billow/db`
      separates server from client:
      `@billow/auth` (server: the auth instance, `requireSession`,
      `requireAdmin`), `@billow/auth/client` (`"use client"`: `authClient`),
      and `@billow/auth/env` (pure: `getAuthEnv`, `resolveTrustedOrigins`,
      `canRegister`). The pure entry is the audit win — the security-critical
      logic becomes testable without Next or a database.
- [ ] Split the Prisma schema into a folder so the seven auth-owned models
      live in their own file. Do this in the same change: the package boundary
      is otherwise code-only, and an auditor still has to read `packages/db`
      for the schema.
- [ ] Update the Dockerfile's manifest `COPY` list in the same commit. The
      image installs with `--filter @billow/web...`, so a new package the web
      app depends on must be copied or the build fails. CI's `docker image`
      job catches this.

Around 37 files import these modules today, so the diff is wide but mechanical.
No image release is needed for the refactor itself; it ships with whatever
feature release follows.

## Suggested order

1. Finish form migration + **Phase 2 API docs** (biggest external value: agents
   and developers can actually use the API keys)
2. **Theming**, then **i18n** (both mostly wiring; theming is nearly free)
3. Session management UI + password reset (closes the obvious auth gaps)
4. Playwright E2E, then backup/restore
5. Passkeys once HTTPS is in place
