#!/bin/sh
# Guards the failure mode that shipped a broken release: a multi-command `run:`
# written as a plain scalar.
#
# YAML folds a plain scalar that continues onto the next line into ONE string
# joined by a space, so
#
#     run: echo "A=1" >> "$GITHUB_ENV"
#       echo "B=2" >> "$GITHUB_ENV"
#
# becomes a single command and the first value swallows the rest of the line.
# Nothing else catches this: the YAML is well-formed, the Actions schema is
# satisfied, and the folded result is even valid shell — `echo` with extra
# arguments and two redirects. actionlint exits 0 on it.
#
# The rule: a `run:` that spans more than one line must use a block scalar
# (`|` or `>`).
set -eu

fail=0

for f in .github/workflows/*.yml .github/workflows/*.yaml .github/actions/*/action.yml; do
  [ -f "$f" ] || continue
  awk -v file="$f" '
    # Remember a `run:` whose value is inline and not a block scalar.
    match($0, /^[[:space:]]*(- )?run:[[:space:]]*/) {
      indent = match($0, /[^ ]/) - 1
      rest = $0
      sub(/^[[:space:]]*(- )?run:[[:space:]]*/, "", rest)
      if (rest ~ /^[|>]/ || rest == "") { pending = 0; next }
      pending = 1; pend_indent = indent; pend_line = NR; next
    }
    pending {
      if ($0 ~ /^[[:space:]]*$/) { next }
      this_indent = match($0, /[^ ]/) - 1
      if (this_indent > pend_indent) {
        printf "%s:%d: `run:` continues onto line %d as a folded plain scalar.\n", file, pend_line, NR
        printf "    Use `run: |` — otherwise YAML joins these into one command.\n"
        bad = 1
      }
      pending = 0
    }
    END { exit bad ? 1 : 0 }
  ' "$f" || fail=1
done

if command -v actionlint >/dev/null 2>&1; then
  actionlint || fail=1
  # actionlint runs shellcheck over every `run:` block, but only if shellcheck
  # is on PATH — otherwise it silently skips that half and still exits 0. CI's
  # runners ship shellcheck, so a local pass here is weaker than a CI pass, and
  # that gap is exactly how two shellcheck findings reached main unnoticed.
  if ! command -v shellcheck >/dev/null 2>&1; then
    echo "check-workflows: shellcheck not installed — CI checks more than this run did." >&2
    echo "check-workflows: install it (brew install shellcheck) to match CI." >&2
  fi
else
  echo "check-workflows: actionlint not installed, skipping schema checks" >&2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-workflows: no folded multi-line \`run:\` scalars"
