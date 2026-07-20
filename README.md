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

For local database work, start Postgres and set `DATABASE_URL` using
`app/.env.example` as the template. Then run:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Useful routes:

- `/`: Server Component rendering app metadata.
- `/api/metadata`: API route returning metadata JSON.

## CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` or
`master`. It installs dependencies from `app/package-lock.json`, generates the
Prisma client, validates the Prisma schema, applies migrations against a
Postgres service, runs ESLint, and builds the Next.js app.

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
