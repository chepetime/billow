#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
APP_DIR="$ROOT_DIR/apps/web"
ENV_FILE="$APP_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/docker-compose.dev.yml"

if [ ! -f "$ENV_FILE" ]; then
  node - <<'NODE' > "$ENV_FILE"
const crypto = require("node:crypto");

const secret = crypto.randomBytes(32).toString("base64");

process.stdout.write(`DATABASE_URL="postgresql://billow:billow-password@localhost:5432/billow?schema=public"
BETTER_AUTH_SECRET="${secret}"
BETTER_AUTH_URL="http://localhost:3000"
`);
NODE
  echo "Created apps/web/.env with local development defaults."
fi

docker compose -f "$COMPOSE_FILE" up -d postgres

printf "Waiting for Postgres"
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U billow -d billow >/dev/null 2>&1; then
    printf "\n"
    break
  fi

  printf "."
  sleep 1
done

if ! docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U billow -d billow >/dev/null 2>&1; then
  printf "\nPostgres did not become ready in time.\n" >&2
  exit 1
fi

cd "$APP_DIR"

pnpm run db:generate
pnpm run db:migrate
pnpm run db:seed

if [ "${1:-}" = "--setup-only" ]; then
  echo "Local database is ready."
  exit 0
fi

pnpm run dev
