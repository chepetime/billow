---
name: release
description: Cut a Billow release and update the Umbrel store. Use when publishing a new version, tagging a release, bumping the image tag, or updating the separate umbrel community app store repo.
---

# Releasing Billow

Releases are tag-driven. `publish.yml` runs only on a pushed `v*` tag (or a
manual `workflow_dispatch` with a `version` input) — never on a plain push to
`main`. Pushing to `main` runs `ci.yml` only. The published image tags are
derived from the git tag, so there is no hardcoded version to keep in sync.

## Cutting a release

Prefer the one-click workflow:

```bash
gh workflow run release.yml -f version=0.1.18
```

It validates the version, bumps the three `package.json`s, re-runs the full
check suite, commits, tags, then calls `publish.yml` directly — a tag pushed
with `GITHUB_TOKEN` does not trigger workflows, which is why it invokes the
called workflow rather than relying on the tag push.

The manual equivalent:

```bash
# bump version in package.json files first, commit, then:
git tag v0.1.7
git push origin v0.1.7
```

This builds and pushes:

```text
ghcr.io/chepetime/billow:v0.1.7   # from the git tag
ghcr.io/chepetime/billow:latest
```

`publish.yml`'s `verify` job confirms the manifest is pullable and boots the
published image against Postgres before the release is considered good.

## Platform and toolchain constraints

The workflow publishes only `linux/amd64` for fast iteration on the current
Umbrel target.

If the target Umbrel is ARM-based later, add `linux/arm64` back and restore
QEMU setup. GitHub-hosted amd64 runners build arm64 through QEMU, so the
Next.js build can sit at `Creating an optimized production build ...` for
several minutes.

Use Node 24-compatible action majors:

- `actions/checkout@v6`
- `docker/setup-buildx-action@v4`
- `docker/login-action@v4`
- `docker/build-push-action@v7`

## GHCR package permissions

The package `ghcr.io/chepetime/billow` was originally created by the store repo
workflow. After the repo split, the first publish from this repo built
successfully but failed to push with:

```text
denied: permission_denied: write_package
```

The fix was a one-time GHCR package setting change: grant `chepetime/billow`
write access to the existing package. After that, workflow rerun `29778177872`
completed successfully.

## Umbrel store update flow

Still manual after every release. The store metadata lives in a separate repo:

```text
/Users/jose/Projects/personal/developer-umbrel-community-app-store
```

1. Get the new image's multi-arch index digest:

   ```bash
   docker buildx imagetools inspect ghcr.io/chepetime/billow:v0.1.28 \
     --format '{{.Manifest.Digest}}'
   ```

2. Update **both the tag and the digest** in the store repo's
   `billow/docker-compose.yml`:

   ```yaml
   image: ghcr.io/chepetime/billow:v0.1.28@sha256:<digest from step 1>
   ```

   Do not skip the digest. Every app in the official store pins one (391 of
   391 at the time of writing), and it is what makes an install reproducible —
   a tag on its own is mutable, so re-pushing it changes what users already
   have. Use the **index** digest shown above, not a per-platform one, so the
   pin stays valid once arm64 is published. A stale digest paired with a new
   tag fails the pull outright, which is the intended safety property: it
   cannot silently install the wrong thing.

3. Bump `version` and `releaseNotes` in `billow/umbrel-app.yml`.
4. Keep `id: billow` unchanged.
5. Keep `${APP_DATA_DIR}/postgres:/var/lib/postgresql/data` unchanged.
6. Push the store repo and refresh the alt store in Umbrel.

The current Umbrel host port is `46247`. Earlier installs failed because the
template port `4000` was already allocated, leaving `app_proxy` in `Created`.
