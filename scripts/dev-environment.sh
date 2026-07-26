#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

wait_for_docker() {
  attempt=0
  while ! docker info >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -eq 1 ] && [ "$(uname)" = "Darwin" ]; then
      echo "Docker is not running; opening Docker Desktop..."
      open -a Docker || true
    fi

    if [ "$attempt" -ge 30 ]; then
      echo "Docker is unavailable. Start Docker Desktop, then retry." >&2
      exit 1
    fi

    sleep 2
  done
}

wait_for_docker

if ! pnpm exec portless doctor; then
  echo "Repairing the Portless HTTP proxy..."
  # Port 80 requires elevation, but plain HTTP does not install a local CA.
  pnpm exec portless proxy start --no-tls
fi

if [ "${1:-}" = "--check" ]; then
  exit 0
fi

exec "$@"
