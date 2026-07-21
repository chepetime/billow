# Billow

Billow is a personal invoices app for Umbrel. It uses Next.js App Router,
React Server Components, Tailwind, shadcn/ui, Prisma, and Postgres.

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
`prisma migrate deploy` (retrying while Postgres comes up) and then
`next start` on port `3000`. The runtime needs `DATABASE_URL`,
`BETTER_AUTH_SECRET` (≥32 chars), and `BETTER_AUTH_URL`.

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
`sparkles-billow/docker-compose.yml`.

## Umbrel Store Contract

The app store package lives in:

```text
/Users/jlugo/Projects/personal/developer-umbrel-community-app-store/sparkles-billow
```

Keep this stable for existing installs:

```yaml
id: sparkles-billow
```

Keep the Postgres volume stable so image updates do not wipe user data:

```yaml
volumes:
  - ${APP_DATA_DIR}/postgres:/var/lib/postgresql/data
```
