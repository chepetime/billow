# syntax=docker/dockerfile:1.7

# Declared before the first FROM so the same value reaches every stage below.
# .nvmrc is authoritative and CI passes it in as a build argument; this default
# exists only so a bare `docker build` works, and scripts/check-node-version.sh
# fails if the two ever disagree.
ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-alpine AS deps

WORKDIR /repo

# Node 26 no longer bundles Corepack, so pnpm is installed directly. The
# version is passed in from package.json's `packageManager` field rather than
# written here, so there is one place that decides it.
ARG PNPM_VERSION=pnpm@11.20.0+sha512.9a6f330a95b66446ea088faf1521405a8a01f07fde7124cc9958dfed52d4bb436737e65b08f85f37b46fcba375092558ac51262b816844b22f63406ed166bfee
RUN npm install --global "$PNPM_VERSION"

# Keep this manifest set limited to the web app's workspace dependency graph.
# In particular, apps/docs is intentionally omitted from the image.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/crypto/package.json ./packages/crypto/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/email/package.json ./packages/email/package.json
COPY packages/shadcn/package.json ./packages/shadcn/package.json
COPY config/tailwind-config/package.json ./config/tailwind-config/package.json
COPY config/typescript-config/package.json ./config/typescript-config/package.json
COPY config/vitest-config/package.json ./config/vitest-config/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --filter @billow/web... --frozen-lockfile --store-dir /pnpm/store

FROM node:${NODE_VERSION}-alpine AS builder

WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

ARG PNPM_VERSION=pnpm@11.20.0+sha512.9a6f330a95b66446ea088faf1521405a8a01f07fde7124cc9958dfed52d4bb436737e65b08f85f37b46fcba375092558ac51262b816844b22f63406ed166bfee
RUN npm install --global "$PNPM_VERSION"

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/auth/node_modules ./packages/auth/node_modules
COPY --from=deps /repo/packages/crypto/node_modules ./packages/crypto/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /repo/packages/email/node_modules ./packages/email/node_modules
COPY --from=deps /repo/packages/shadcn/node_modules ./packages/shadcn/node_modules
COPY --from=deps /repo/config ./config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/web ./apps/web
COPY packages/auth ./packages/auth
COPY packages/crypto ./packages/crypto
COPY packages/db ./packages/db
COPY packages/email ./packages/email
COPY packages/shadcn ./packages/shadcn
COPY config ./config
RUN pnpm --filter @billow/web build \
  && rm -rf apps/web/.next/cache

# The standalone server is traced from runtime imports only, so the Prisma CLI
# — a build-time tool the entrypoint still needs for `migrate deploy` — is not
# in it, and has to be reinstalled here as a plain flat tree the runner can
# COPY.
#
# npm rather than pnpm on purpose. pnpm's store nests each package's
# dependencies under its own `.pnpm/<pkg>@<version>/node_modules` directory, so
# copying prisma and its immediate siblings still misses transitive deps
# (`@prisma/config` needs `effect`, which lives beside `@prisma/config`, not
# beside `prisma`) and the CLI dies with MODULE_NOT_FOUND at boot. npm produces
# the full closure in one real directory.
#
# The versions are read from the lockfile-resolved install in `deps` rather
# than written literally, so bumping Prisma in the workspace cannot leave the
# image running a different CLI than the repo.
FROM node:${NODE_VERSION}-alpine AS migrator
COPY --from=deps /repo/packages/db/node_modules/prisma/package.json /tmp/prisma.json
COPY --from=deps /repo/packages/db/node_modules/dotenv/package.json /tmp/dotenv.json
WORKDIR /migrate
RUN set -eu; \
  prisma_version="$(node -p "require('/tmp/prisma.json').version")"; \
  dotenv_version="$(node -p "require('/tmp/dotenv.json').version")"; \
  echo "installing prisma@${prisma_version} dotenv@${dotenv_version}"; \
  npm install --omit=dev --no-audit --no-fund --no-package-lock \
    "prisma@${prisma_version}" "dotenv@${dotenv_version}"; \
  # Alternative database drivers and the TypeScript compiler, none of which
  # `migrate deploy` loads. Each was removed and the real command re-run to
  # confirm it still works before being listed here.
  #
  # `@prisma/studio-core` (~42 MB) and `@prisma/dev` (~18 MB) look like
  # equally obvious cuts and are NOT: the CLI bundle requires both at load
  # time, so removing either fails immediately with MODULE_NOT_FOUND even
  # though `migrate deploy` never uses a studio or a dev server. That is why
  # the migration toolchain stays around 225 MB.
  rm -rf node_modules/mysql2 node_modules/postgres node_modules/typescript

FROM node:${NODE_VERSION}-alpine AS runner

WORKDIR /repo
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000
# Cap V8's heap so the idle server returns memory instead of holding it.
# ~halves idle RSS (~145MiB -> ~60MiB) with ample headroom for this app.
ENV NODE_OPTIONS=--max-old-space-size=128

# No corepack/pnpm here any more. The runner used to `pnpm install --prod` the
# whole dependency graph, which was most of the image; it now receives Next's
# traced standalone output instead, and the only other thing it runs is the
# Prisma CLI, invoked through `node` directly.

# Runs as the base image's own `node` account, uid/gid 1000:1000. That is not
# arbitrary: Umbrel creates ${APP_DATA_DIR} as 1000:1000, so a bind-mounted
# uploads directory is owned by 1000 and only uid 1000 can write it — a
# directory at mode 755 gives everyone else r-x. A dedicated user at 1001 could
# not, which is why the entrypoint used to become root and chown on every boot.
#
# No user is created here: `node` already exists in the base image at 1000:1000.
#
# The image no longer installs su-exec and the entrypoint has no privileged
# phase: `USER` below means the container never starts as root in the first
# place, whether or not the caller passes `--user`. Umbrel's compose sets
# `user: "1000:1000"` as well, which is redundant but explicit.
#
# NOTE: this drops the automatic chown that used to repair an uploads directory
# owned by the old 1001 uid. Installs that ran 0.1.29 or 0.1.30 were migrated
# already. One that jumps straight from 0.1.28 or earlier keeps a 1001-owned
# directory, and uploads fail until it is chowned to 1000 by hand — start.sh
# logs exactly that.

# Uploads live on a mounted volume so they survive container replacement. The
# mount point is created and owned here for the no-volume case and for named
# volumes, which are seeded from the image, ownership included. A bind mount
# arrives with the host's ownership and masks this entirely — that case is
# handled by the host directory being 1000-owned (Umbrel creates it that way,
# and the store repo commits an empty `uploads/` so it exists before first
# boot), not by anything the image can do once it is no longer root.
ENV BILLOW_STORAGE_DIR=/data/uploads
RUN mkdir -p /data/uploads && chown -R node:node /data

# The standalone bundle already mirrors the workspace layout (apps/web,
# packages/*) and carries its own pruned node_modules, so it unpacks straight
# onto the workdir. Everything the server imports is either inside it or
# bundled into .next/server — there is nothing left to install.
#
# Unlike the old per-package COPY list, this needs no maintenance when a
# workspace package is added: tracing decides what ships.
COPY --from=builder /repo/apps/web/.next/standalone ./
# Static assets and public files are excluded from tracing by design and have
# to be placed alongside the server by hand.
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

# Migration toolchain: the schema and its config, plus the flattened CLI from
# the migrator stage. `prisma.config.ts` resolves `prisma/config` and
# `dotenv/config` out of this node_modules, so it has to sit at the package
# root rather than anywhere else.
COPY packages/db/prisma ./packages/db/prisma
COPY packages/db/prisma.config.ts ./packages/db/prisma.config.ts
COPY --from=migrator /migrate/node_modules ./packages/db/node_modules

COPY apps/web/scripts ./apps/web/scripts

# Everything above is copied as root and left world-readable; the app only ever
# reads it. Declared after the COPYs so they are not slowed by ownership
# rewrites, and before CMD so it applies to the running process.
USER node

EXPOSE 3000

# Workdir stays at the repo root: the entrypoint runs migrations from
# packages/db and then starts the standalone server at apps/web/server.js.
CMD ["sh", "apps/web/scripts/start.sh"]
