#!/bin/sh
set -eu

# Every line is prefixed so it can be picked out of `docker logs` and Umbrel's
# combined output, and so the boot sequence is greppable after the fact.
log() {
  echo "[billow:start] $*"
}

STORAGE_DIR="${BILLOW_STORAGE_DIR:-/data/uploads}"
APP_USER=node

# Ownership and mode of a path, or a reason it cannot be read. Used before and
# after the chown so the log shows what actually changed rather than what was
# intended.
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

# A bind-mounted volume arrives with the HOST's ownership and masks whatever the
# image baked in, so uploads fail with EACCES unless the owner matches the app
# user. Umbrel creates ${APP_DATA_DIR} as 1000:1000 and the app runs as uid 1000
# to match, so on a current Umbrel this phase has nothing to do. It stays for
# installs whose directory predates that change (it was 1001), and for a plain
# `docker run` with no --user, where the container still starts as root.
if [ "$(id -u)" = "0" ]; then
  log "running as root: normalising ownership before dropping to ${APP_USER}"
  mkdir -p "${STORAGE_DIR}"
  before=$(describe_path "${STORAGE_DIR}")
  chown -R "${APP_USER}:${APP_USER}" "${STORAGE_DIR}"
  log "storage dir ${before} -> $(describe_path "${STORAGE_DIR}") (owner:group mode)"
  # Re-exec through sh: this script is invoked as `sh scripts/start.sh` and is
  # not marked executable, so su-exec cannot exec the path directly.
  log "dropping privileges via su-exec"
  # Marks the second pass so the message below can tell "dropped from root"
  # apart from "started unprivileged". That distinction is the whole signal for
  # whether the privileged phase is still doing anything: once Umbrel runs this
  # container as 1000:1000 it should never appear, and the phase can go.
  BILLOW_DROPPED_PRIVILEGES=1 exec su-exec "${APP_USER}" sh "$0" "$@"
fi

# From here on the process is unprivileged and stays that way.
if [ -n "${BILLOW_DROPPED_PRIVILEGES:-}" ]; then
  log "running as uid $(id -u) after dropping from root"
elif [ "$(id -u)" = "1000" ]; then
  log "started unprivileged as uid 1000; the root phase was not needed"
else
  log "WARNING: running as uid $(id -u), not 1000 — a bind-mounted ${STORAGE_DIR} owned by 1000 will not be writable"
fi

if touch "${STORAGE_DIR}/.write-probe" 2>/dev/null; then
  rm -f "${STORAGE_DIR}/.write-probe"
  log "storage dir is writable by uid $(id -u)"
else
  # Not fatal: the app still serves, and /api/health plus the diagnostics page
  # report storage separately. Failing the boot here would take the whole app
  # down over a feature that may be unused on this install.
  log "WARNING: storage dir ${STORAGE_DIR} is NOT writable by uid $(id -u) — uploads will fail"
fi

log "applying database migrations"
attempt=0

until pnpm --filter @billow/db exec prisma migrate deploy; do
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
exec node node_modules/next/dist/bin/next start
