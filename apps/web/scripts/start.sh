#!/bin/sh
set -eu

# Bind-mounted volumes arrive owned by root and mask the ownership baked into
# the image, so uploads would fail with EACCES. Fix it while we still have the
# privileges to, then drop to the unprivileged user for everything after.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${BILLOW_STORAGE_DIR:-/data/uploads}"
  chown -R nextjs:nodejs "${BILLOW_STORAGE_DIR:-/data/uploads}"
  # Re-exec through sh: the script is invoked as `sh scripts/start.sh` and is
  # not marked executable, so su-exec cannot exec the path directly.
  exec su-exec nextjs sh "$0" "$@"
fi

attempt=0

until pnpm --filter @billow/db exec prisma migrate deploy; do
  attempt=$((attempt + 1))

  if [ "$attempt" -ge 30 ]; then
    echo "Database migrations failed after $attempt attempts."
    exit 1
  fi

  echo "Database is not ready yet. Retrying migrations..."
  sleep 2
done

exec node node_modules/next/dist/bin/next start
