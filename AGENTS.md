# Repository Notes

This is the Billow app repository. The Umbrel store metadata lives separately in:

```text
/Users/jlugo/Projects/personal/developer-umbrel-community-app-store
```

Remote:

```text
https://github.com/chepetime/billow
```

The app was split out of the store repo in initial commit
`3c9fc0d Initial Billow app`.

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
   `sparkles-billow/docker-compose.yml`.
2. Bump `version` and `releaseNotes` in
   `sparkles-billow/umbrel-app.yml`.
3. Keep `id: sparkles-billow` unchanged.
4. Keep `${APP_DATA_DIR}/postgres:/var/lib/postgresql/data` unchanged.
5. Push the store repo and refresh the alt store in Umbrel.

The current Umbrel host port is `46247`. Earlier installs failed because the
template port `4000` was already allocated, leaving `app_proxy` in `Created`.
