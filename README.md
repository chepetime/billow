# Billow

Billow is a base setup for self-hosted apps, packaged for Umbrel. It exists so
that the parts every such app needs — accounts, two-factor, an API, migrations,
backups, a Docker image, a release pipeline — are already built and tested, and
the only thing left is the domain you actually care about.

## Stack

| Layer | What it uses |
| --- | --- |
| Interface | Next.js 16 (App Router, React Server Components), React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui on Base UI |
| Data | PostgreSQL 16, Prisma 7, Zod 4, React Hook Form |
| Identity | better-auth — email and username sign-in, TOTP two-factor with backup codes, personal API keys, admin roles and impersonation |
| Platform | next-intl, next-themes, Resend email, file uploads, workspace backup/restore, health endpoint, persisted error log |
| Build and ship | pnpm workspaces, Turborepo, Vitest, Playwright, Docker on Node 24, GitHub Actions publishing to GHCR |

The signed-in app ships a small invoicing workspace. It is a worked example of
the platform rather than the point — a real domain wired through the same auth,
validation, backup and API conventions, there to be replaced by yours.

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

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` or
`master`. It installs dependencies from `pnpm-lock.yaml`, generates the
Prisma client, validates the Prisma schema, applies migrations against a
Postgres service, runs ESLint, runs Vitest, and builds the Next.js app.

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

To cut a release:

```bash
# 1. bump the version in the package.json files and commit
# 2. tag and push the tag
git tag v0.1.7
git push origin v0.1.7
```

That builds and pushes (`linux/amd64`):

```text
ghcr.io/chepetime/billow:v0.1.7   # from the git tag
ghcr.io/chepetime/billow:latest
```

The Umbrel app store repo then references the new versioned image from its
`billow/docker-compose.yml`.

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
