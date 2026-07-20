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

- npm workspaces + Turborepo monorepo.
- `apps/web`: Next.js App Router app.
- `apps/web/prisma/schema.prisma`: Prisma schema.
- `apps/web/prisma/migrations`: SQL migrations.
- `apps/web/prisma/seed.mjs`: Explicit dev/bootstrap seed.
- `apps/web/scripts/start.sh`: Production startup script.
- `Dockerfile`: Production image build.
- `.github/workflows/publish.yml`: GHCR image publishing workflow.

## Local Commands

Run from the repo root:

```bash
npm install
npm run db:generate
npm run db:validate
npm run lint
npm run test:run
npm run build
```

For local DB work, run Postgres in Docker and Next.js on the host:

```bash
npm run dev:local
```

Useful local commands:

```bash
npm run db:up
npm run dev:setup
npm run dev
npm run db:logs
npm run db:down
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
npm run start
```

The script retries migrations while Postgres starts.

## Publishing

The workflow publishes only `linux/amd64` for fast iteration on the current
Umbrel target:

```text
ghcr.io/chepetime/billow:v0.1.6
ghcr.io/chepetime/billow:latest
```

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
