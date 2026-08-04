#!/bin/sh
# Fails if a pinned toolchain version is declared in more than one truth.
#
# Node comes from .nvmrc; pnpm from package.json's `packageManager`. CI passes
# both into the image build as build arguments. The Dockerfile still needs
# defaults so a bare `docker build` works, and those defaults are the values
# that can drift — this check is what stops them.
set -eu

fail=0

# Strip a leading "v": nvm and fnm happily write "v26.6.0" into .nvmrc, and
# `node:v26.6.0-alpine` is not a tag that exists. That rewrite happened once
# and would have failed the build rather than anything earlier.
nvmrc="$(tr -d ' \t\n\r' < .nvmrc | sed 's/^v//')"
case "$nvmrc" in
  ""|*[!0-9.]*)
    echo "check-versions: .nvmrc must be a plain version usable as a docker tag, got '$(cat .nvmrc)'" >&2
    exit 1 ;;
esac
docker_node="$(sed -n 's/^ARG NODE_VERSION=\([0-9][0-9.]*\).*/\1/p' Dockerfile | head -1)"
if [ -z "$docker_node" ]; then
  echo "check-versions: no 'ARG NODE_VERSION=' default in Dockerfile" >&2
  fail=1
elif [ "$nvmrc" != "$docker_node" ]; then
  echo "check-versions: .nvmrc says Node '$nvmrc', Dockerfile default is '$docker_node'." >&2
  echo "  .nvmrc is the source of truth; update the Dockerfile default." >&2
  fail=1
fi

pkg_pnpm="$(node -p "require('./package.json').packageManager")"
for got in $(sed -n 's/^ARG PNPM_VERSION=\(.*\)$/\1/p' Dockerfile); do
  if [ "$got" != "$pkg_pnpm" ]; then
    echo "check-versions: package.json says '$pkg_pnpm', Dockerfile default is '$got'." >&2
    echo "  package.json's packageManager is the source of truth." >&2
    fail=1
  fi
done

[ "$fail" -eq 0 ] || exit 1
echo "check-versions: Node $nvmrc, $pkg_pnpm — consistent across .nvmrc, package.json and Dockerfile"
