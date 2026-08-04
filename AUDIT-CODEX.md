# Billow self-hosted application audit

**Audit date:** 2026-08-03

**Code reviewed:** `a929a8d` (`main`, application version `0.1.43`)

**Focus:** security, performance, reliability, operations, and capabilities expected of a production self-hosted application

## Executive assessment

Billow has a better foundation than most early self-hosted applications. It builds as a standalone Next.js service, runs as an unprivileged user, applies migrations before startup, scopes the main data paths by user, validates uploaded file content, encrypts selected database fields, and verifies the published image against a real Postgres instance. The repository also has useful operational documentation and a meaningful automated test suite.

The application is not yet a hardened reusable base. The most important problems are at architectural boundaries: sensitive database fields can bypass the encryption client, every Prisma operation is transparently retried even when a write may already have committed, initial ownership is established with a race-prone user count, and expensive cryptographic and restore operations have request-rate controls but no concurrency or process-resource controls. These are more important than adding caching or another feature.

Recommended posture:

| Area | Current assessment | Target before broader production use |
| --- | --- | --- |
| Security | Good primitives, incomplete enforcement seams | Make secure access paths mandatory and test the raw persistence boundary |
| Reliability | Strong CI and startup behavior, unsafe ambiguous-write retry | Retry only operations that are demonstrably idempotent |
| Performance | Fine for a small workspace, unbounded hot paths | Bound queries, streams, and expensive concurrent work |
| Operations | Solid release/smoke-test baseline | Add full-install backup, restore drills, resource budgets, and supply-chain attestations |
| Product readiness | Useful single-user foundation | Add safe bootstrap, invitations, scoped API keys, audit history, and HTTPS-aware operation |

## What is already strong

- The production container runs as UID 1000, uses Next.js standalone output, and does not seed at startup.
- Startup applies Prisma migrations with database readiness retries.
- The Umbrel store pins the Billow and Postgres runtime images by digest and supplies health checks.
- CI covers lint, unit tests, builds, migrations against Postgres, dependency audit, a production Docker boot, and shared smoke tests. The publish workflow also boots the published image.
- Authentication rate limiting is explicitly enabled and database-backed rather than relying on process memory.
- Custom cookie-authenticated mutations generally enforce same-origin requests.
- Uploads use generated storage keys, path containment checks, MIME sniffing, per-user lookups, quotas, attachment disposition, and `no-store` responses.
- Sensitive database fields use AES-GCM with associated data and per-user data keys. Password, recovery-key, session, and two-factor transitions have been considered explicitly.
- Persisted error messages and stacks redact connection strings and provider credentials.
- The public health endpoint exposes little information.

These controls should be preserved while the enforcement gaps below are closed.

## Priority 0 — address before treating Billow as a hardened base

### 1. The encrypted-data boundary is optional in practice

**Risk:** High — plaintext financial and identity data can be written to the database, and some reads can return ciphertext to application views.

`packages/db/src/field-encryption.ts` says adding a field to `ENCRYPTED_FIELDS` is the complete change, but `getPrisma()` remains public and can bypass the extension.

Confirmed bypasses include:

- `apps/web/src/app/actions.ts` creates a bank account through the plain client. Account holder, account number, routing, SWIFT, IBAN, and CLABE values are therefore written as plaintext.
- `apps/web/src/lib/backup.ts` restores user profile and bank account fields through the plain client.
- `apps/web/src/lib/invoice-workspace.ts#getInvoiceById` loads encrypted relations through the plain client.
- The encryption extension transforms only the top-level Prisma model. An `Invoice.findMany({ include: { bankAccount, userProfile } })` operation has `Invoice` as its model, so the current code does not open encrypted fields nested in included relations. A `BankAccount` query similarly does not recursively open an included `UserProfile`.

The sign-in backfill eventually seals plaintext rows, but it does not protect the interval between a write and the next sign-in. It also makes correctness depend on a later authentication event.

**Guidance:**

1. Introduce one request-scoped workspace data-access module that captures `userId` and the data key. Expose domain operations from it rather than a pass-through Prisma client.
2. Keep the plain client internal to infrastructure/authentication code. Workspace code should not be able to import it for models containing protected data.
3. Encrypt writes inside interactive transactions used by create and restore paths. Confirm that the chosen Prisma extension behavior applies inside transactions.
4. Handle nested relations deliberately: query protected models through their protected repository, or recursively transform known relation results. Do not assume Prisma query extensions cover includes.
5. Add an encryption migration/version marker per user so a completed backfill is not a full table scan on every sign-in.

**Acceptance criteria:**

- Integration tests inspect raw Postgres rows and prove every protected column is ciphertext after create, update, onboarding, and backup restore.
- Application-level tests prove the same rows decrypt correctly through list and detail paths, including nested invoice relations.
- A cross-user data-key substitution test returns no plaintext.
- A repository check prevents workspace modules from importing the unrestricted client.

### 2. Global retries can replay writes after an ambiguous connection failure

**Risk:** High — duplicate writes, inconsistent state, or data loss.

`packages/db/src/index.ts` installs a `$allOperations` extension that retries connection failures for every Prisma operation. A connection reset does not prove that a write failed; the database may have committed and the response may have been lost.

One concrete failure chain exists in upload creation: the file is written before the database row is created. If the first insert commits and the response is lost, a transparent retry can hit the unique storage key. The outer error path can then remove the file while the committed row remains, leaving a database record pointing at missing content.

**Guidance:**

- Restrict transparent retry to known read operations.
- Make mutation retry an explicit domain decision using idempotency keys or a transaction/outbox design.
- Treat P1002/timeouts as ambiguous for mutations.
- Reconcile file and database state with a durable pending/complete state or a periodic orphan/missing-file repair job.

**Acceptance criteria:** fault-injection tests simulate a response loss after commit and demonstrate exactly-once observable behavior for uploads, invoices, backups, and auth-adjacent writes.

### 3. First-user ownership is race-prone and can be claimed remotely

**Risk:** High on a newly exposed installation.

The authentication hooks in `packages/auth/src/auth.ts` count users before sign-up and count again afterward to promote the first user. Concurrent sign-ups can both pass the precondition and can leave an unexpected owner state. More fundamentally, the first network client to register owns a fresh instance.

**Guidance:**

- Serialize bootstrap in Postgres using a transaction plus an advisory lock or a single-row compare-and-set.
- Require a one-time setup secret/claim code surfaced by Umbrel or container logs for the initial owner.
- Close public registration after ownership is claimed.
- Use explicit invitations for subsequent users.

**Acceptance criteria:** a concurrency test launches multiple first-registration attempts and creates exactly one owner; registration without the setup secret cannot claim an uninitialized instance.

### 4. Password-reset links can trust request-controlled host headers

**Risk:** High when Billow is reachable directly, through a permissive proxy, or from another application on a shared network.

When no public URL is configured, `packages/email/src/public-url.ts` derives the email origin from `x-forwarded-host` or `host`. `apps/web/src/lib/auth-mailer.ts` then moves the reset token to that origin. A hostile host header can cause the victim's email to link to an attacker-controlled origin that receives the token when clicked.

**Guidance:**

- Require an operator-pinned canonical public URL before password-reset email is enabled, or validate the derived origin against a strict configured allowlist.
- Only trust forwarded headers from a known reverse proxy boundary.
- Do not place a reset token in a URL selected solely from request headers.

**Acceptance criteria:** hostile `Host` and `X-Forwarded-Host` tests cannot influence a reset link, while configured LAN, Tailscale, and tunnel origins continue to work.

### 5. Expensive operations are rate-limited but not concurrency-limited

**Risk:** High availability risk on small self-hosted hardware.

`apps/web/src/lib/api/rate-limit.ts` performs `findUnique`, a decision, and then `update`; concurrent requests can all observe the same count and be allowed. A fixed-window request limit also does not prevent an allowed burst from running many scrypt operations simultaneously. The comment connects a 64 MB scrypt bound to V8's 128 MB old-space limit, but native crypto memory and Node buffers are not bounded by V8 old space.

Restore is similarly burst-sensitive: `apps/web/src/app/api/admin/restore/route.ts` buffers the unbounded compressed body, synchronously inflates it, and retains archive entries in memory. Concurrent 10 MB upload/download paths also buffer data.

**Guidance:**

- Make counters atomic with a Postgres upsert/conditional update.
- Add a process-wide semaphore or small queue around password KDF, vault, and recovery-key operations.
- Reject oversized restore bodies using `Content-Length` when present and enforce a streaming compressed and decompressed byte cap.
- Stream upload downloads and backup archives rather than copying whole files through memory.
- Define and test container memory, CPU, and PID budgets on representative Raspberry Pi/Umbrel hardware.
- Calibrate scrypt parameters from an explicit login latency and memory target.

**Acceptance criteria:** concurrent load tests remain responsive and inside the container memory budget; excess KDF work receives a bounded queue or `429/503` response rather than crashing the process.

### 6. The pinned Node/Prisma combination has a support warning

**Risk:** High operational uncertainty, even though the current build passes.

The repository pins Node `26`; this audit ran on Node `v26.6.0` with Prisma `7.9.1`. Prisma's install-time compatibility check warned that it supports Node 20.19+, 22.12+, and 24.0+. Its package `engines` metadata is broader (`^20.19 || ^22.12 || >=24.0`), so the package itself presents conflicting signals. Lint, tests, and build pass, but that does not establish production support for the query engine and migration CLI.

**Guidance:** pin Node 24 until Prisma explicitly supports Node 26, or upgrade Prisma to a release whose installer and documentation agree on Node 26 support. Extend `scripts/check-versions.sh` from consistency-only checks to a tested compatibility matrix.

**Acceptance criteria:** dependency installation has no runtime-support warning and migration, query, backup/restore, and Docker smoke tests run on the exact production Node version.

## Priority 1 — production hardening and scale correctness

### 7. Tenant ownership is enforced in application code, not by relational invariants

`Invoice` stores its own `userId` while referencing profile, bank account, and client rows. Actions usually validate ownership before writing, but the database cannot prevent an invoice owned by one user from referencing another user's related row. A future missed check could expose sensitive data through an otherwise correctly scoped invoice query.

Use composite owner-aware foreign keys, repeat `userId` on owned children where appropriate, or make the workspace repository the only mutation boundary. Add negative integration tests for every cross-tenant relationship.

### 8. API-key behavior needs explicit policy, scopes, and credential provenance

The BetterAuth API-key plugin is initialized with defaults. The installed plugin defaults include a very low request allowance, while the UI creates a key with only a name. This can make legitimate integrations fail after a small number of calls. The schema supports permissions, but routes do not enforce capability scopes; a personal key is effectively broad account access.

Custom routes also infer “API-key credentialed” from the presence of any `Authorization` header. Authentication may actually fall back to a browser session, yet same-origin enforcement is skipped. Browsers currently make exploitation harder through CORS preflight, but that is accidental protection.

Return an identity object such as `{ userId, via: "session" | "apiKey", scopes }` from one authentication module. Base CSRF and authorization decisions on the verified credential, not header presence. Configure key expiry, rate policy, rotation, last-used display, and per-route scopes explicitly. Add idempotency keys and stable pagination/error formats before encouraging automation.

### 9. Backups and uploaded content are sensitive plaintext export surfaces

Database field encryption does not protect uploaded file bytes. Workspace backups intentionally export decrypted profile and banking data and raw upload content. That is useful, but it moves sensitive plaintext into browser downloads, cloud-sync folders, snapshots, and Umbrel volumes.

Document the threat model and make the export behavior explicit in the UI. Add `Cache-Control: no-store` to backup responses. Prefer an encrypted backup format wrapped by the recovery key or a separately supplied export passphrase. Consider streaming envelope encryption for uploads under the user's data key, while designing how API-key downloads are authorized when no browser data-key cookie exists.

### 10. Account deletion leaves file lifecycle outside the transaction

`apps/web/src/app/api/account/route.ts` deletes owned database rows but does not remove the user's upload directory. Cascading upload-row deletion therefore leaves sensitive orphan files on disk.

Record deletion intent in the database, remove the user-scoped directory after commit, and run a reconciler for interrupted cleanup. Provide a visible deletion/audit outcome. Never recursively delete from an unresolved path; use the generated user storage prefix and containment guard.

### 11. Dashboard and invoice reads are unbounded

`getInvoiceWorkspace` loads every invoice, every line item, three revisions per invoice, all profiles, all bank accounts, and all clients. Totals are calculated in JavaScript, and the dashboard later shows only a small recent subset. This will produce growing latency, memory, and decryption cost on a process configured with a small heap.

Add database pagination and `take` limits, query only fields rendered by the page, compute counts/aggregates in Postgres, and omit revision payloads from list views. Add composite indexes matching the actual filters and ordering, especially `(userId, invoiceDate)` and `(userId, status)`. Set and test a supported workspace-size envelope.

Totals currently combine invoices and format the result as MXN even when invoices can carry different currencies. Group totals by currency or introduce an explicit exchange-rate/accounting policy; never silently sum unlike currencies.

### 12. Authentication and data-key lookups are duplicated within a request

Layouts, pages, recovery state, the workspace client, and data-key access can repeat session and key-wrap queries for one render. Create a request-local auth context, cached with React's request memoization, that returns the verified session, user, data-key availability, and recovery state. Keep decrypted material request-scoped; do not place user-sensitive results in shared or cross-request caches.

### 13. Password administration can orphan encrypted data

The user administration UI exposes BetterAuth's `setUserPassword`. An administrative password replacement does not possess the old password and therefore cannot safely rewrap the user's data key. The user can arrive at a state where authentication succeeds but encrypted fields are unavailable unless a valid recovery key exists.

Remove this operation until it participates in the recovery-key workflow, or require an explicit recovery-assisted reset with a prominent data-loss warning. Record security-relevant administrator actions in an immutable audit log.

### 14. Deployment needs explicit HTTP and HTTPS security modes

Billow must work on local HTTP, so cookies and transport defaults cannot simply assume HTTPS. The same defaults can remain weak when the instance is placed behind a TLS tunnel. Define two explicit modes:

- LAN HTTP: clearly document the local-network trust assumption and avoid claiming transport confidentiality.
- HTTPS: require a canonical origin, secure cookies, trusted proxy configuration, HSTS, and stricter origin policy.

Passkeys/WebAuthn should be added only with stable HTTPS origins. A CSP nonce is the next browser-hardening step; the current policy still permits inline script/style behavior.

### 15. Error metadata can bypass log redaction

`apps/web/src/lib/error-log.ts` redacts error messages and stacks but stores `meta` as supplied. The email test route records the recipient email in metadata, contrary to the repository's sensitive-data logging guidance.

Use a small allowlisted metadata schema, hash or omit user identifiers where possible, and apply recursive key/value redaction before persistence. Remove recipient addresses, tokens, storage paths, invoice contents, and provider responses from stored/logged metadata.

### 16. Full-install backup and recovery are not yet defined

The current backup is the signed-in administrator's workspace export. It is not an installation backup: it does not capture every user's workspace, authentication records, installation configuration, or a point-in-time Postgres state.

Add an operator-level backup design with scheduled encrypted exports, retention, off-device targets, versioned format/migrations, and automated restore verification. Keep user-portable export and disaster-recovery backup as distinct product concepts.

## Priority 2 — operational maturity and maintainability

### 17. Container and network hardening should match the self-hosted threat model

If Umbrel supports the settings, test and add `read_only`, a small writable `tmpfs`, `cap_drop: [ALL]`, `no-new-privileges`, and explicit memory/CPU/PID limits. Billow and Postgres currently share credentials derived from `APP_SEED`, and that same value is also the authentication secret; this collapses database, session, and email-key compartments. Derive independent installation secrets and store them with a rotation/recovery story.

Umbrel applications may be peers on a shared network. A unique database hostname prevents accidental collision but does not prevent a compromised peer from reaching or observing database traffic. Prefer an isolated network and Postgres TLS where the platform permits it; otherwise document the peer-application trust assumption.

### 18. Supply-chain controls can be stronger

- Pin GitHub Actions by commit SHA rather than moving major tags.
- Replace the remote actionlint download script with a checksummed artifact or pinned action.
- Pin Docker build-stage base images by digest and automate digest refreshes.
- Produce an SBOM and signed provenance/attestation for releases.
- Add image vulnerability scanning, CodeQL/SAST, and secret scanning.
- Test migrations from the previous released schema with representative encrypted and unencrypted data, not only a fresh database.
- Move critical login, recovery, backup/restore, and upload Playwright flows into the release gate; nightly coverage can remain broader.

### 19. Diagnostics contain blind spots

Storage diagnostics count only direct entries even though files are stored in nested user directories, so reported file count/bytes can be wrong. Scan recursively with bounds and without following unsafe links. Use `/proc/self/mountinfo` when available to distinguish the data mount reliably.

Separate liveness from readiness/degraded health. Database failure should affect readiness; storage write failure, migration mismatch, and email failure should appear as component state without exposing secrets publicly.

### 20. The primary documentation has drifted from the implementation

Examples found during this audit:

- README and landing content say TypeScript 5 and Node 24; the repository uses TypeScript 7 and Node 26.
- Architecture documentation describes `middleware.ts`; the application uses `src/proxy.ts`.
- Package documentation describes obsolete Docker `COPY` behavior and omits current workspace packages.
- Operations text describes a root-to-`nextjs` transition, while the current image starts as UID 1000.

Because `apps/docs` is designated the source of truth, drift here is an operational risk. Add docs assertions to version/workflow checks where facts can be mechanical, and make architecture/docs updates part of the acceptance criteria for structural changes.

### 21. Build warnings should be kept from becoming upgrade blockers

The current build passes but reports a dynamic dependency warning through the Scalar/web-worker API documentation path. Vitest also warns about native config loading of ESM syntax from a CommonJS-shaped config. Keep the API reference route lazy and isolated from core UI bundles, and move the Vitest config to an unambiguous ESM form before its future fallback is removed.

## Recommended product capabilities

The following features are part of operating a trustworthy self-hosted product, not merely feature expansion.

### Essential next capabilities

1. **Safe installation claim and invitations** — one-time owner claim, registration closed by default afterward, expiring invitations, and a visible member/role audit trail.
2. **Disaster recovery** — scheduled encrypted installation backup, off-device target, retention policy, restore preview, compatibility checks, and periodic automated restore drills.
3. **Scoped automation** — expiring API keys, least-privilege scopes, usage/last-seen UI, rotation, idempotency keys, pagination, stable error codes, and optional webhooks.
4. **Security audit log** — owner/member changes, sign-ins, recovery changes, key operations, backup/restore, email configuration, and destructive actions, with no sensitive payloads.
5. **Resource-aware operation** — documented supported hardware, storage/quota visibility, background jobs with bounded concurrency, and actionable degraded-health diagnostics.
6. **HTTPS identity mode** — canonical URL, secure cookies, trusted proxy configuration, passkeys, and optional OIDC/SSO for installations that have stable TLS origins.

### Domain/product follow-ons

- Correct multi-currency reporting and explicit accounting semantics.
- PDF invoice generation, numbering rules, delivery history, and revision/audit guarantees.
- Pluggable object storage for larger installations, with encryption and lifecycle controls.
- Notifications and background delivery/retry rather than request-bound long work.
- Data retention, export, and deletion controls per user and per installation.

Avoid adding generic extension points before two real consumers exist. The best near-term architecture is a small number of deep modules: request identity, workspace persistence/encryption, storage, backup/restore, and background work.

## Suggested delivery sequence

### Phase 1: close correctness and security seams

- Make protected persistence mandatory and add raw-database encryption tests.
- Remove global mutation retry and add fault-injection coverage.
- Serialize installation claim and require a setup secret.
- Pin/validate the Node and Prisma support combination.
- Pin password-reset links to a trusted canonical origin.
- Add atomic rate limits and a KDF concurrency guard.

### Phase 2: bound resources and recovery

- Stream/cap restore, backup, upload, and download paths.
- Paginate invoice/workspace reads and move aggregates to Postgres.
- Add request-local auth/data-key context.
- Implement upload deletion reconciliation and full-install encrypted backups.
- Set container limits and run representative concurrency/load tests.

### Phase 3: operational and ecosystem maturity

- Add scoped/expiring API keys, invitations, and security audit history.
- Add HTTPS mode and then passkeys/OIDC as required.
- Harden the container/network and release supply chain.
- Repair documentation drift and automate checks for versioned facts.

## Verification performed

The audit included direct inspection of the docs, Prisma schema/data paths, authentication and recovery flows, encryption, uploads, backups, diagnostics, Docker image, Umbrel metadata, and GitHub workflows.

Local validation:

- `CI=true pnpm install --frozen-lockfile` — passed, with the Prisma/Node compatibility warning described above.
- `CI=true pnpm run lint` — passed across 293 files.
- `CI=true pnpm run test:run` — passed, 185 tests across crypto, auth, email, and web packages.
- `CI=true pnpm run build` — passed for the application and docs.
- `scripts/check-versions.sh` — passed consistency checks.
- Dependency audit — no unreviewed high/critical advisory; one moderate transitive Hono advisory was reported.

Not exercised locally in this audit: the full Playwright suite, a production Docker boot, multi-architecture execution, destructive restore fault injection, or a representative hardware load test. CI covers portions of these, but the new acceptance tests above are still needed.

## Exit criteria for “production-hardened base”

Billow can reasonably use that description when:

- protected columns cannot be written or read through an unprotected workspace path;
- mutation retries are idempotent by construction;
- exactly one authenticated setup claimant can own a new installation;
- reset links and session cookies are bound to an explicit deployment origin policy;
- expensive work stays within tested CPU and memory budgets under concurrency;
- user deletion removes both relational and file data;
- installation backups are encrypted, scheduled, and successfully restored in automation;
- API keys are scoped, expiring, observable, and tested;
- previous-version migrations and critical user journeys gate a release;
- the primary documentation accurately describes the shipped architecture and operations.
