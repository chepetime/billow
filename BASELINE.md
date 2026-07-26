# Billow baseline (self-hosted app starter)

Billow has become, in practice, a **base setup for self-hosted Umbrel apps**.
This document tracks the *platform* layer only — everything a self-hosted app
needs regardless of its domain.

The invoicing domain checklist lives separately in [`progress.txt`](progress.txt).

Legend: `[x]` done · `[ ]` todo · `[~]` partially done

---

## Auth & accounts

- [x] Email + password sign-up / sign-in (BetterAuth + Prisma adapter)
- [x] First-user-only registration (`databaseHooks.user.create.before` guard)
- [x] Session-gated route group + optimistic middleware redirect
- [x] Username as an alternative login identifier
- [x] Change email (direct update; no mail transport in this app)
- [x] Change password (revokes other sessions)
- [x] Two-factor auth (TOTP, QR enrolment, single-use backup codes)
- [x] Origin handling that works behind any proxy/host (no pinned domain)
- [ ] **Password reset flow** — `sendResetPassword` currently only logs the URL.
      Needs either a real mail transport or a "copy this link" admin surface.
- [ ] **Session management UI** — list active sessions and revoke individually
      (`auth.api.listSessions` / `revokeSession` already exist)
- [ ] **Account deletion** (`auth.api.deleteUser`) with a confirmation step
- [ ] **Passkeys** — `@better-auth/passkey@1.6.25` is ready, but WebAuthn needs a
      secure context. Blocked until the app is reached over HTTPS (Tailscale
      certs or a Cloudflare tunnel). Needs a `passkey` table + migration.
- [ ] Email verification (only if a mail transport is ever added)
- [ ] Multi-user support: roles/admin, invitations, closing or reopening
      registration from the UI (today it is strictly first-user-only)

## API

- [x] Personal API keys (`@better-auth/api-key`): create, list, revoke in settings
- [x] `GET /api/v1/me` — accepts `x-api-key` or `Authorization: Bearer`, or a session
- [ ] **Public API docs** — generate `/api/v1/openapi.json` from the zod schemas
      via `z.toJSONSchema()` and render it at `/docs/api` with a locally bundled
      `@scalar/api-reference-react` (no CDN, works offline)
- [ ] Enable BetterAuth's built-in `openAPI()` plugin so auth endpoints are
      documented too
- [ ] Shared route helpers: `lib/api/identity.ts` (`requireApiIdentity`) and
      `lib/api/respond.ts` (consistent `{ error }` shape, zod 400s) — the auth
      logic is currently inlined in the one route
- [ ] Documented conventions: versioning, pagination, error codes
- [ ] Per-key rate limiting (the api-key plugin supports it; not yet configured)
- [ ] Key expiry / last-used surfacing in the UI

## UI & UX

- [x] Minimal landing page with sign-in / sign-up (sign-up hidden once closed)
- [x] Dashboard shell + account settings
- [~] **Form validation** — zod schemas + `Field` + react-hook-form wired into
      sign-in, sign-up, and two-factor. Still to migrate: `account-form`,
      `two-factor-section`, `api-keys-section`
- [x] Theming — `next-themes` applies the existing palette, with persisted
      light/dark/system controls on authenticated and public entry pages.
- [ ] **i18n** — `next-intl@4`, cookie-based (`NEXT_LOCALE`, no URL prefix),
      messages in `messages/{en,es}.json`, language picker in settings
- [ ] Toast / notification system (success + error feedback is inline-only today)
- [ ] Loading and empty states pass
- [ ] Accessibility pass (keyboard nav, focus rings, screen-reader labels)
- [ ] Mobile layout pass

## Operations

- [x] `/health` page + `/api/health` JSON (version, uptime, memory, DB, auth,
      session, recent errors)
- [x] Persistent error log in the database, surfaced through the API
- [x] Migrations run automatically at container start, with retry
- [x] Transient DB connection retries; auth failures fail fast
- [x] Memory capped (`--max-old-space-size=128`; ~60 MiB idle)
- [ ] Backup / restore: JSON export + import of all app data
- [ ] Structured logging (currently `console.*`)
- [ ] Log retention — `ErrorLog` grows unbounded; add pruning or a cap
- [ ] Graceful degradation review: every page should render when the DB is down
      (landing and `/health` already do)

## Security

- [x] Secrets from env, never hardcoded (`BETTER_AUTH_SECRET` ← `${APP_SEED}`)
- [x] Bank/account numbers masked outside explicit detail views
- [x] API keys stored hashed, shown once
- [ ] **Revisit CSRF posture** — `trustedOrigins` currently trusts the request
      Origin so the app works behind any front door. Tighten once HTTPS and a
      stable hostname exist.
- [ ] Security headers / CSP
- [ ] Rate limiting on auth endpoints (brute-force protection)
- [ ] Dependency audit in CI (`pnpm audit`)

## Release & packaging

- [x] Tag-driven releases (`v*` → GHCR); pushes to `main` only run CI
- [x] Verify the GHCR manifest exists before bumping the store
- [x] Parallel CI (lint/test/build matrix + migrations) with checksum-keyed caches
- [x] Local CI runs via `act`
- [x] Self-hosted app icon in the store repo
- [ ] **Gallery images** — still the same placeholder imgur URL three times.
      Best fix: real screenshots of the running app (landing, dashboard, settings)
- [ ] `CHANGELOG.md` generated from tags
- [ ] Multi-arch images (`linux/arm64`) if a non-amd64 Umbrel is ever targeted
- [ ] Document required env vars for anyone reusing this as a template

## Developer experience

- [x] `pnpm run dev:local` (Postgres in Docker + Next on the host, seeded)
- [x] Unit tests with Vitest
- [ ] **End-to-end tests** (Playwright): sign-up → dashboard, 2FA enrolment,
      API key → `/api/v1/me`
- [ ] `db:reset` command for a clean local database
- [ ] Extract the platform layer into a reusable template once the invoicing
      domain lands on top (the long-term goal implied by all of the above)

---

## Suggested order

1. Finish form migration + **Phase 2 API docs** (biggest external value: agents
   and developers can actually use the API keys)
2. **Theming**, then **i18n** (both mostly wiring; theming is nearly free)
3. Session management UI + password reset (closes the obvious auth gaps)
4. Playwright E2E, then backup/restore
5. Passkeys once HTTPS is in place
