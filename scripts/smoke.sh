#!/bin/sh
# Smoke-test a running Billow instance.
#
#   scripts/smoke.sh [base-url]        (default http://localhost:3000)
#
# Checks the behaviour that has actually broken in production before:
# the app boots, the database is reachable, auth is configured, protected
# routes redirect, and the public API rejects unauthenticated callers.
set -eu

BASE="${1:-http://localhost:3000}"
fails=0

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }

check() {
  label="$1"
  actual="$2"
  expected="$3"
  if [ "$actual" = "$expected" ]; then
    printf '  ok    %-38s %s\n' "$label" "$actual"
  else
    printf '  FAIL  %-38s %s (expected %s)\n' "$label" "$actual" "$expected"
    fails=$((fails + 1))
  fi
}

printf 'Smoke testing %s\n' "$BASE"

# Wait for the server to accept connections.
i=0
until curl -s -o /dev/null --max-time 5 "$BASE/api/health" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "  FAIL  server never became reachable" >&2
    exit 1
  fi
  sleep 2
done

check "GET /                     " "$(code "$BASE/")" 200
check "GET /login                " "$(code "$BASE/login")" 200
check "GET /health               " "$(code "$BASE/health")" 200
check "GET /api/health           " "$(code "$BASE/api/health")" 200
check "GET /dashboard (anon)     " "$(code "$BASE/dashboard")" 307
check "GET /api/v1/me (no auth)  " "$(code "$BASE/api/v1/me")" 401
check "GET /api/v1/me (bad key)  " "$(code -H 'x-api-key: invalid' "$BASE/api/v1/me")" 401

# /api/health reports database + auth wiring; treat a non-ok body as a failure
# even though the endpoint itself answered.
health="$(curl -s --max-time 10 "$BASE/api/health" || echo '{}')"
if printf '%s' "$health" | grep -q '"ok":true'; then
  printf '  ok    %-38s ok\n' "/api/health reports ok"
else
  printf '  FAIL  %-38s %s\n' "/api/health reports ok" "$(printf '%s' "$health" | head -c 200)"
  fails=$((fails + 1))
fi

if [ "$fails" -gt 0 ]; then
  printf '\n%s check(s) failed\n' "$fails" >&2
  exit 1
fi

printf '\nAll smoke checks passed\n'
