# Billow

Billow is a personal invoices app for Umbrel. It uses Next.js App Router,
React Server Components, Tailwind, shadcn/ui, Prisma, and Postgres.

## Local Development

Run app commands from `app`:

```bash
cd app
npm install
npm run db:generate
npm run lint
npm run build
```

`npm run build` runs `prisma generate && next build --webpack`.

For the normal local setup, run Postgres in Docker and Next.js on your host:

```bash
cd app
npm install
npm run dev:local
```

`npm run dev:local` creates an ignored `app/.env` if one does not exist, starts
Postgres from `docker-compose.dev.yml`, generates the Prisma client, applies
migrations, seeds local data, and starts `next dev`.

Useful local commands:

```bash
npm run db:up      # start local Postgres only
npm run dev:setup  # start Postgres, generate Prisma, migrate, and seed
npm run dev        # start Next.js only
npm run db:logs    # follow Postgres logs
npm run db:down    # stop local Postgres
```

If you create `app/.env` yourself, use `app/.env.example` as the template. Set
`BETTER_AUTH_SECRET` to at least 32 random characters and `BETTER_AUTH_URL` to
your local app URL.

Useful routes:

- `/`: Server Component rendering app metadata.
- `/api/metadata`: API route returning metadata JSON.

## CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` or
`master`. It installs dependencies from `app/package-lock.json`, generates the
Prisma client, validates the Prisma schema, applies migrations against a
Postgres service, runs ESLint, runs Vitest, and builds the Next.js app.

## Docker

Build from the repository root:

```bash
docker build -t ghcr.io/chepetime/billow:v0.1.6 .
```

The production image starts with `app/scripts/start.sh`, runs
`prisma migrate deploy`, then runs `next start` on port `3000`.

## Publishing

`.github/workflows/publish.yml` publishes:

```text
ghcr.io/chepetime/billow:v0.1.6
ghcr.io/chepetime/billow:latest
```

The Umbrel app store repo references the versioned image from its
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
