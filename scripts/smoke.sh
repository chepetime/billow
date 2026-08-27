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
# Missing credentials must read as "authenticate", not "forbidden": an origin
# check running before authentication would answer 403 and mislead clients.
check "GET /api/v1/uploads (no auth)" "$(code "$BASE/api/v1/uploads")" 401
check "POST /api/v1/uploads (no auth)" "$(code -X POST "$BASE/api/v1/uploads")" 401
check "GET /api/v1/clients (no auth)" "$(code "$BASE/api/v1/clients")" 401
check "GET /api/v1/clients/1 (no auth)" "$(code "$BASE/api/v1/clients/1")" 401
check "POST /api/v1/clients (no auth)" "$(code -X POST "$BASE/api/v1/clients")" 401
check "PUT /api/v1/clients/1 (no auth)" "$(code -X PUT "$BASE/api/v1/clients/1")" 401
check "DELETE /api/v1/clients/1 (no auth)" "$(code -X DELETE "$BASE/api/v1/clients/1")" 401

# The probe is deliberately boolean-only: {"status":"ok"} when the database is
# reachable, {"status":"unavailable"} with 503 when it is not.
health="$(curl -s --max-time 10 "$BASE/api/health" || echo '{}')"
if printf '%s' "$health" | grep -q '"status":"ok"'; then
  printf '  ok    %-38s %s\n' "/api/health reports ready" "$health"
else
  printf '  FAIL  %-38s %s\n' "/api/health reports ready" "$(printf '%s' "$health" | head -c 200)"
  fails=$((fails + 1))
fi

# The public surfaces must not leak internals: no versions, memory, stack
# traces, or environment. This guards the split that moved detail behind auth.
leaks="$(curl -s --max-time 10 "$BASE/health" | grep -ciE "heap|memory|stack|node v|process\.env" || true)"
if [ "$leaks" = "0" ]; then
  printf '  ok    %-38s none\n' "/health leaks no internals"
else
  printf '  FAIL  %-38s %s match(es)\n' "/health leaks no internals" "$leaks"
  fails=$((fails + 1))
fi

# Diagnostics must stay behind authentication.
for path in /admin/debug /api/admin/diagnostics; do
  status="$(code "$BASE$path")"
  case "$status" in
    401|307|302)
      printf '  ok    %-38s %s\n' "$path is protected" "$status" ;;
    *)
      printf '  FAIL  %-38s %s (expected 401/307)\n' "$path is protected" "$status"
      fails=$((fails + 1)) ;;
  esac
done

if [ "$fails" -gt 0 ]; then
  printf '\n%s check(s) failed\n' "$fails" >&2
  exit 1
fi

printf '\nAll smoke checks passed\n'
