#!/bin/sh
set -eu

attempt=0

until pnpm exec prisma migrate deploy; do
  attempt=$((attempt + 1))

  if [ "$attempt" -ge 30 ]; then
    echo "Database migrations failed after $attempt attempts."
    exit 1
  fi

  echo "Database is not ready yet. Retrying migrations..."
  sleep 2
done

exec pnpm run start
