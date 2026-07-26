# Repository Notes

This is the Billow app repository. The Umbrel store metadata lives separately in:

```text
/Users/jose/Projects/personal/developer-umbrel-community-app-store
```

Remote:

```text
https://github.com/chepetime/billow
```

The app was split out of the store repo in initial commit
`3c9fc0d Initial Billow app`.

## Documentation

`apps/docs` is a Fumadocs site and the **primary source of truth** for
architecture, conventions, package responsibilities, and operations. Read it
before changing anything structural, and put new documentation there rather than
growing this file.

```bash
pnpm --filter @billow/docs dev   # http://localhost:3001
```

Content lives in `apps/docs/content/docs/*.mdx`; navigation order is
`content/docs/meta.json`. The docs app is intentionally excluded from the
production image.

## App Shape

- pnpm workspaces + Turborepo monorepo.
- `apps/web`: Next.js App Router app.
- `packages/db`: `@billow/db` package — owns Prisma and exports `getPrisma()`.
- `packages/db/prisma/schema.prisma`: Prisma schema.
- `packages/db/prisma/migrations`: SQL migrations.
- `packages/db/prisma/seed.mjs`: Explicit dev/bootstrap seed.
- `packages/db/generated/prisma`: Generated Prisma client (gitignored).
- `apps/web/scripts/start.sh`: Production startup script.
- `Dockerfile`: Production image build.
- `.github/workflows/publish.yml`: GHCR image publishing workflow.

## Local Commands

Run from the repo root:

```bash
pnpm install
pnpm run db:generate
pnpm run db:validate
pnpm run lint
pnpm run test:run
pnpm run build
```

For local DB work, run Postgres in Docker and Next.js on the host:

```bash
pnpm run dev:local
```

Useful local commands:

```bash
pnpm run db:up
pnpm run dev:setup
pnpm run dev
pnpm run db:logs
pnpm run db:down
```

## Build Notes

The web package build uses:

```bash
prisma generate && next build --webpack
```

Webpack is intentional. Turbopack previously hit a local sandbox port-binding
failure during CSS processing.

Prisma 7 reads seed configuration from `prisma.config.ts`:

```ts
migrations: {
  path: "prisma/migrations",
  seed: "node prisma/seed.mjs",
}
```

Production startup does not seed. The app must tolerate an empty metadata table.

## Docker Runtime

Build from this repo root:

```bash
docker build -t ghcr.io/chepetime/billow:v0.1.6 .
```

The container starts with:

```text
apps/web/scripts/start.sh
```

Startup sequence:

```bash
prisma migrate deploy
pnpm run start
```

The script retries migrations while Postgres starts.

## Publishing

Releases are tag-driven. `publish.yml` runs only on a pushed `v*` tag (or a
manual `workflow_dispatch` with a `version` input) — never on a plain push to
`main`. Pushing to `main` runs `ci.yml` only. The published image tags are
derived from the git tag, so there is no hardcoded version to keep in sync.

To cut a release:

```bash
# bump version in package.json files first, commit, then:
git tag v0.1.7
git push origin v0.1.7
```

This builds and pushes:

```text
ghcr.io/chepetime/billow:v0.1.7   # from the git tag
ghcr.io/chepetime/billow:latest
```

The workflow publishes only `linux/amd64` for fast iteration on the current
Umbrel target.

The package `ghcr.io/chepetime/billow` was originally created by the store repo
workflow. After the repo split, the first publish from this repo built
successfully but failed to push with:

```text
denied: permission_denied: write_package
```

The fix was a one-time GHCR package setting change: grant `chepetime/billow`
write access to the existing package. After that, workflow rerun `29778177872`
completed successfully.

If the target Umbrel is ARM-based later, add `linux/arm64` back and restore QEMU
setup. GitHub-hosted amd64 runners build arm64 through QEMU, so the Next.js
build can sit at `Creating an optimized production build ...` for several
minutes.

Use Node 24-compatible action majors:

- `actions/checkout@v6`
- `docker/setup-buildx-action@v4`
- `docker/login-action@v4`
- `docker/build-push-action@v7`

## Umbrel Store Update Flow

After publishing a new image tag:

1. Update the image tag in the store repo's
   `billow/docker-compose.yml`.
2. Bump `version` and `releaseNotes` in
   `billow/umbrel-app.yml`.
3. Keep `id: billow` unchanged.
4. Keep `${APP_DATA_DIR}/postgres:/var/lib/postgresql/data` unchanged.
5. Push the store repo and refresh the alt store in Umbrel.

The current Umbrel host port is `46247`. Earlier installs failed because the
template port `4000` was already allocated, leaving `app_proxy` in `Created`.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`chepetime/billow`), managed with the
`gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` plus `docs/adr/` at the repo root. See
`docs/agents/domain.md`.

## CI/CD

Workflows live in `.github/workflows`:

- **`ci.yml`** — runs on every push/PR. Parallel `lint` / `test:run` / `build`
  matrix, a `migrations` job against a real Postgres, and a `docker` job that
  builds the production image, boots it, and runs `scripts/smoke.sh`. Superseded
  runs are cancelled via a concurrency group.
- **`release.yml`** — one-click release (`workflow_dispatch`, or
  `gh workflow run release.yml -f version=0.1.18`). Validates the version, bumps
  the three `package.json`s, re-runs the full check suite, commits, tags, then
  calls `publish.yml`. Replaces the old manual bump/tag/verify sequence.
- **`publish.yml`** — builds and pushes the GHCR image. Also callable via
  `workflow_call` (a tag pushed with `GITHUB_TOKEN` does not trigger workflows,
  so `release.yml` invokes it directly). Its `verify` job confirms the manifest
  is pullable and boots the published image against Postgres before the release
  is considered good.
- **`claude-review.yml`** — AI review on every PR, plus `@claude` mentions in
  issues and comments. Needs an `ANTHROPIC_API_KEY` secret; skips cleanly without one.

`scripts/smoke.sh <base-url>` is the shared smoke test (routes, auth redirects,
API 401s, and `/api/health` reporting ok). Run it locally too.

Dependabot (`.github/dependabot.yml`) updates npm, Actions, and Docker weekly.
`better-auth` minor/major bumps are deliberately ignored — 1.7 is a breaking
release that needs a data migration.

**Still manual after a release:** bump the Umbrel store repo (compose image tag
and `umbrel-app.yml` version/releaseNotes), then refresh the store in Umbrel.
