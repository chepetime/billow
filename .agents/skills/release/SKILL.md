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

The workflow publishes `linux/amd64` and `linux/arm64` under one manifest
list, building **each architecture on a runner of that architecture**
(`ubuntu-latest` and `ubuntu-24.04-arm`) and merging the two digests into a
manifest list afterwards. Per-architecture registry caches are
`ghcr.io/chepetime/billow:buildcache-{amd64,arm64}`.

Do not "simplify" this back to one job with `platforms:` and QEMU. That was
tried in 0.1.31 and does not work — the emulated arm64 build dies partway
through `next build`:

```text
qemu: uncaught target signal 4 (Illegal instruction) - core dumped
Next.js build worker exited with code: null and signal: SIGILL
```

QEMU's arm64 translation does not cover everything Next's build workers
execute. The amd64 half succeeded in the same run, and the same commit builds
cleanly on real hardware of both architectures, so this is an emulator limit
rather than anything in this repo. Native ARM runners are free for public
repositories and are also much faster.

`verify` asserts both architectures are present in the published manifest.
That check exists because every other check in that job runs on an amd64
runner, so an accidentally amd64-only manifest would pass all of them and
fail only when someone installs on a Raspberry Pi.

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

**It is not permanently one-time.** The link is a property of the package
pointing at a repository, so deleting the repository breaks it — and deleting
and recreating `chepetime/billow` is exactly what the August 2026 personal-data
purge did. The package survived (GHCR packages are namespaced to the user, not
the repo, which is why the old images had to be deleted by hand), but it came
back unlinked, and the 0.1.1 release failed to push with the same
`write_package` error.

Check for it before releasing:

```bash
gh api user/packages/container/billow -q '.repository.full_name // "NONE"'
```

`NONE` means the next publish will fail. There is no REST endpoint to repair
it; it has to be the UI, at

```text
https://github.com/users/chepetime/packages/container/billow/settings
```

under **Manage Actions access** → **Add repository** → `chepetime/billow`,
role **Write**. The same applies to `goose`.

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
   `chepetime-billow/docker-compose.yml`:

   ```yaml
   image: ghcr.io/chepetime/billow:v0.1.28@sha256:<digest from step 1>
   ```

   Do not skip the digest. Every app in the official store pins one (391 of
   391 at the time of writing), and it is what makes an install reproducible —
   a tag on its own is mutable, so re-pushing it changes what users already
   have. Use the **index** digest shown above, not a per-platform one: the
   index covers both amd64 and arm64, while a per-platform digest would pin
   every install to one architecture. A stale digest paired with a new tag
   fails the pull outright, which is the intended safety property: it cannot
   silently install the wrong thing.

3. Bump `version` and `releaseNotes` in `chepetime-billow/umbrel-app.yml`.
4. Keep `id: chepetime-billow` unchanged. The directory and the id are both
   store-prefixed: a community store silently drops an app whose id is not
   prefixed with the store id (`chepetime`), so it vanishes from the store
   without an error anywhere.
5. Keep `${APP_DATA_DIR}/postgres:/var/lib/postgresql/data` unchanged.
6. Push the store repo and refresh the alt store in Umbrel.

### Changing compose without a new image

Umbrel decides whether to offer an update by comparing `version` in
`umbrel-app.yml` against what is installed. A store change that edits only
`docker-compose.yml` and leaves `version` alone therefore **never shows an
update badge**, and refreshing the store does not apply it either — a refresh
only rewrites the store's copy of the file. It takes effect when the app is
next started, because that is when `docker compose` re-reads it.

So a compose-only change needs the app stopped and started by hand, and
anyone waiting for an update prompt waits forever. If the change should reach
users the normal way, cut a release so there is a version to compare against.

The current Umbrel host port is `46247`. Earlier installs failed because the
template port `4000` was already allocated, leaving `app_proxy` in `Created`.
