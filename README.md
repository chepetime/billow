# Billow

Billow is a self-hosted invoice manager, packaged for Umbrel. It generates
invoices, exports them as PDFs, and tracks what happens to each one afterwards:
sent, received, paid, turned into a CFDI by the accountant, and included in a
filed monthly tax report.

Writing the invoice is the short part of the job. Knowing months later which
ones are unfinished is the long part, and that is what Billow is for.

## Stack

| Layer | What it uses |
| --- | --- |
| Interface | Next.js 16 (App Router, React Server Components), React 19, TypeScript 7, Tailwind CSS 4, shadcn/ui on Base UI |
| Data | PostgreSQL 16, Prisma 7, Zod 4, React Hook Form |
| Identity | better-auth — email and username sign-in, TOTP two-factor with backup codes, personal API keys, admin roles and impersonation |
| Platform | next-intl, next-themes, Resend email, file uploads, workspace backup/restore, health endpoint, persisted error log |
| Build and ship | pnpm workspaces, Turborepo, Vitest, Playwright, Biome, Docker on Node 26, GitHub Actions publishing to GHCR |

Underneath the invoicing sits a full platform layer — accounts, two-factor, an
API, per-user field encryption, migrations, backups, a Docker image, a release
pipeline. It began life as a general-purpose base setup and is still worth
reading as one, but it now exists to serve invoicing rather than to be replaced
by another domain.

## Local Development

Run project commands from the repository root:

```bash
pnpm install
pnpm run db:generate
pnpm run lint
pnpm run build
```

`pnpm run build` runs the Turborepo build pipeline. Prisma lives in the
`@billow/db` workspace package (`packages/db`), which owns the schema,
migrations, seed, and generated client. The web app consumes it via
`getPrisma()` and builds with
`pnpm --filter @billow/db db:generate && next build --webpack`.

For the normal local setup, run Postgres in Docker and Next.js on your host:

```bash
pnpm install
pnpm run dev:local
```

`pnpm run dev:local` creates an ignored `apps/web/.env` if one does not exist,
starts Postgres from `docker-compose.dev.yml`, generates the Prisma client,
applies migrations, seeds local data, and starts `next dev`.

Useful local commands:

```bash
pnpm run db:up      # start local Postgres only
pnpm run dev:setup  # start Postgres, generate Prisma, migrate, and seed
pnpm run dev        # start Next.js only
pnpm run db:logs    # follow Postgres logs
pnpm run db:down    # stop local Postgres
```

If you create `apps/web/.env` yourself, use `apps/web/.env.example` as the
template. Set `BETTER_AUTH_SECRET` to at least 32 random characters and
`BETTER_AUTH_URL` to your local app URL.

Useful routes:

- `/`: Server Component rendering app metadata.
- `/api/metadata`: API route returning metadata JSON.

## CI

`.github/workflows/ci.yml` runs on every push and pull request: a parallel
matrix runs Biome, Vitest, and the Next.js build; a separate `migrations` job
applies the Prisma schema against a real Postgres service; and a `docker` job
builds the production image, boots it, and runs `scripts/smoke.sh` against it
— so a Dockerfile or runtime break is caught before a release tag ever exists.

## Deployment

### Build the image locally

Build from the repository root:

```bash
docker build -t ghcr.io/chepetime/billow:local .
```

The production image starts with `apps/web/scripts/start.sh`, which runs
`prisma migrate deploy` (retrying while Postgres comes up) and then the
standalone server at `apps/web/server.js` on port `3000`. The runtime needs
`DATABASE_URL`, `BETTER_AUTH_SECRET` (≥32 chars), and `BETTER_AUTH_URL`.

The image ships Next's `output: "standalone"` bundle — the traced server plus
only the `node_modules` files it actually reaches — rather than an installed
dependency tree, so there is no `pnpm` or `next` CLI in it. The Prisma CLI is
reinstalled separately in the `migrator` stage purely so migrations can run at
boot. Images are published for `linux/amd64` and `linux/arm64`.

### Releases (tag-driven)

Releases are decoupled from CI. Pushing to `main` runs `ci.yml` only — it
never publishes. `.github/workflows/publish.yml` runs **only** when a `v*`
tag is pushed (or via a manual `workflow_dispatch` with a `version` input),
and the image tags are derived from the git tag, so there is no hardcoded
version to maintain.

To cut a release, one click from the Actions tab or the CLI:

```bash
gh workflow run release.yml -f version=0.1.18
```

`release.yml` validates the version, bumps the three `package.json` files,
re-runs the full check suite, commits, tags, and calls `publish.yml`, which
builds and pushes both platforms:

```text
ghcr.io/chepetime/billow:v0.1.18   # from the git tag
ghcr.io/chepetime/billow:latest
```

Pushing a `v*` tag by hand also works and takes the same `publish.yml` path.
See `apps/docs/content/docs/releasing.mdx` for the full procedure, including
the manual Umbrel store step that follows every release.

## Umbrel Store Contract

The app store package lives in:

```text
/Users/jose/Projects/personal/developer-umbrel-community-app-store/billow
```

Keep this stable for existing installs:

```yaml
id: billow
```

Keep the Postgres volume stable so image updates do not wipe user data:

```yaml
volumes:
  - ${APP_DATA_DIR}/postgres:/var/lib/postgresql/data
```
