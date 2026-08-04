# Repository Notes

This is the Billow app repository. The Umbrel store metadata lives separately in:

```text
/Users/jose/Projects/personal/developer-umbrel-community-app-store
```

Remote:

```text
https://github.com/chepetime/billow
```

The app was split out of the store repo in initial commit
`3c9fc0d Initial Billow app`.

## Documentation

`apps/docs` is a Fumadocs site and the **primary source of truth** for
architecture, conventions, package responsibilities, and operations. Read it
before changing anything structural, and put new documentation there rather than
growing this file.

```bash
pnpm --filter @billow/docs dev   # http://localhost:3001
```

Content lives in `apps/docs/content/docs/*.mdx`; navigation order is
`content/docs/meta.json`. The docs app is intentionally excluded from the
production image.

## Adding a workspace package

The `Dockerfile` has explicit per-package `COPY` lines in three places: the
manifest and the pruned `node_modules` for the deps stage, and the sources for
the builder. A new package that is not added to all three builds locally and
fails only in the image, with `Module not found`.

The runner stage needs nothing: it unpacks Next's standalone bundle, so tracing
decides what ships. That was not always true — do not re-add a per-package
`COPY` there on the strength of an older note.

Package manifests must stay mode 644. Editing one through `mktemp` + `mv`
silently leaves it at 600, and `COPY` carries that into the image, where the
unprivileged `nextjs` user can no longer read it and the container dies at
startup.

## Node version

`.nvmrc` is the single source of truth for Node, and package.json's
`packageManager` for pnpm (Node 26 dropped Corepack, so pnpm is installed
directly). CI's setup action reads it via
`node-version-file`, and the image builds pass it in as the `NODE_VERSION`
build argument. The `ARG NODE_VERSION` default in the `Dockerfile` exists only
so a bare `docker build` works; `scripts/check-versions.sh` runs in CI and
fails if it drifts from `.nvmrc`.

Do not inline a Node version anywhere else. The composite action and the
Dockerfile were already out of step once — CI kept building on the old major
while the image moved on, and nothing said so.

## Build Notes

Webpack (`next build --webpack`) is intentional. Turbopack previously hit a
local sandbox port-binding failure during CSS processing.

Production startup does not seed. The app must tolerate an empty metadata table.

`apps/web/scripts/start.sh` runs `prisma migrate deploy` before starting, and
retries while Postgres comes up. It drops from root to the `nextjs` user, so it
must re-exec through `sh` — the script is not marked executable.

## Releasing

Releases are tag-driven: never publish from a plain push to `main`. The full
procedure — cutting the tag, GHCR permissions, platform constraints, and the
manual Umbrel store update that follows every release — lives in
`.claude/skills/release/SKILL.md`. Read that file before publishing.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`chepetime/billow`), managed with the
`gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context — this repo has one domain, not several bounded contexts. See
`docs/agents/domain.md`.

## CI/CD

Workflows live in `.github/workflows`:

- **`ci.yml`** — runs on every push/PR. Parallel `lint` / `test:run` / `build`
  matrix, a `migrations` job against a real Postgres, and a `docker` job that
  builds the production image, boots it, and runs `scripts/smoke.sh`. Superseded
  runs are cancelled via a concurrency group.
- **`release.yml`** — one-click release (`workflow_dispatch`, or
  `gh workflow run release.yml -f version=0.1.18`). Validates the version, bumps
  the three `package.json`s, re-runs the full check suite, commits, tags, then
  calls `publish.yml`. Replaces the old manual bump/tag/verify sequence.
- **`publish.yml`** — builds and pushes the GHCR image. Also callable via
  `workflow_call` (a tag pushed with `GITHUB_TOKEN` does not trigger workflows,
  so `release.yml` invokes it directly). Its `verify` job confirms the manifest
  is pullable and boots the published image against Postgres before the release
  is considered good.
- **`claude-review.yml`** — AI review on every PR, plus `@claude` mentions in
  issues and comments. Needs an `ANTHROPIC_API_KEY` secret; skips cleanly without one.

`scripts/smoke.sh <base-url>` is the shared smoke test (routes, auth redirects,
API 401s, and `/api/health` reporting ok). Run it locally too.

Dependabot (`.github/dependabot.yml`) updates npm, Actions, and Docker weekly.
`better-auth` minor/major bumps are deliberately ignored — 1.7 is a breaking
release that needs a data migration.

**Still manual after a release:** bump the separate store repo's
`billow/docker-compose.yml` image tag and `billow/umbrel-app.yml`
version/releaseNotes, then refresh the store in Umbrel. Steps in
`.claude/skills/release/SKILL.md`.
