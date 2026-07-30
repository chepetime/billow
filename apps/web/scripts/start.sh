#!/bin/sh
set -eu

# Every line is prefixed so it can be picked out of `docker logs` and Umbrel's
# combined output, and so the boot sequence is greppable after the fact.
log() {
  echo "[billow:start] $*"
}

STORAGE_DIR="${BILLOW_STORAGE_DIR:-/data/uploads}"

# Ownership and mode of a path, or a reason it cannot be read.
describe_path() {
  if [ ! -e "$1" ]; then
    echo "missing"
  elif owner=$(stat -c '%u:%g %a' "$1" 2>/dev/null); then
    echo "$owner"
  else
    echo "unreadable"
  fi
}

log "pid $$ uid $(id -u) gid $(id -g) ($(id -un 2>/dev/null || echo '?'))"
log "storage dir ${STORAGE_DIR} is $(describe_path "${STORAGE_DIR}")"

# This script never runs as root. The image declares `USER node` (uid 1000), so
# there is no privileged phase to drop out of — earlier versions started as
# root purely to chown a bind-mounted uploads directory that a uid-1001 app user
# could not write, then re-executed themselves through su-exec.
#
# What replaced it: the app user is uid 1000, which is the uid Umbrel creates
# ${APP_DATA_DIR} with, so the bind mount is already owned correctly. Production
# confirmed the root phase had stopped doing anything before it was removed.
if [ "$(id -u)" != "1000" ]; then
  log "WARNING: running as uid $(id -u), not 1000 — a bind-mounted ${STORAGE_DIR} owned by 1000 will not be writable"
fi

# Best effort, and unprivileged now: this succeeds when the parent is writable
# (the image owns /data) and fails silently when a bind mount arrived
# root-owned. Either way the probe below reports the outcome that matters.
mkdir -p "${STORAGE_DIR}" 2>/dev/null || true

if touch "${STORAGE_DIR}/.write-probe" 2>/dev/null; then
  rm -f "${STORAGE_DIR}/.write-probe"
  log "storage dir is writable by uid $(id -u)"
else
  # Not fatal: the app still serves, and /api/health plus the diagnostics page
  # report storage separately. Failing the boot here would take the whole app
  # down over a feature that may be unused on this install.
  log "WARNING: storage dir ${STORAGE_DIR} is NOT writable by uid $(id -u) — uploads will fail"
fi

# Repo root, derived from this script's own location rather than assumed, so
# the script works whether it is invoked from /repo or from apps/web.
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)

# There is no pnpm in the production image any more — it ships Next's traced
# standalone output instead of an installed dependency tree. The Prisma CLI is
# copied in flattened, so it is invoked through node directly. Running from
# packages/db is what lets the CLI find prisma.config.ts.
run_migrations() {
  (
    cd "${REPO_ROOT}/packages/db" \
      && node node_modules/prisma/build/index.js migrate deploy
  )
}

log "applying database migrations"
attempt=0

until run_migrations; do
  attempt=$((attempt + 1))

  if [ "$attempt" -ge 30 ]; then
    log "database migrations failed after $attempt attempts; giving up"
    exit 1
  fi

  log "database is not ready yet (attempt $attempt/30); retrying in 2s"
  sleep 2
done

if [ "$attempt" -gt 0 ]; then
  log "migrations applied after $attempt retries"
else
  log "migrations applied on the first attempt"
fi

log "starting next on port ${PORT:-3000}"
# Standalone output ships its own minimal server rather than the `next start`
# CLI, which is not present in the image.
exec node "${REPO_ROOT}/apps/web/server.js"
