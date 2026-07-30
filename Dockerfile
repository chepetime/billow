# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps

WORKDIR /repo

RUN corepack enable && corepack install --global pnpm@10.34.1

# Keep this manifest set limited to the web app's workspace dependency graph.
# In particular, apps/docs is intentionally omitted from the image.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/email/package.json ./packages/email/package.json
COPY packages/shadcn/package.json ./packages/shadcn/package.json
COPY config/eslint-config/package.json ./config/eslint-config/package.json
COPY config/tailwind-config/package.json ./config/tailwind-config/package.json
COPY config/typescript-config/package.json ./config/typescript-config/package.json
COPY config/vitest-config/package.json ./config/vitest-config/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --filter @billow/web... --frozen-lockfile --store-dir /pnpm/store

FROM node:24-alpine AS builder

WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/auth/node_modules ./packages/auth/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /repo/packages/email/node_modules ./packages/email/node_modules
COPY --from=deps /repo/packages/shadcn/node_modules ./packages/shadcn/node_modules
COPY --from=deps /repo/config ./config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/web ./apps/web
COPY packages/auth ./packages/auth
COPY packages/db ./packages/db
COPY packages/email ./packages/email
COPY packages/shadcn ./packages/shadcn
COPY config ./config
RUN pnpm --filter @billow/web build \
  && rm -rf apps/web/.next/cache

FROM node:24-alpine AS runner

WORKDIR /repo
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000
ENV COREPACK_HOME=/usr/local/share/corepack
# Cap V8's heap so the idle server returns memory instead of holding it.
# ~halves idle RSS (~145MiB -> ~60MiB) with ample headroom for this app.
ENV NODE_OPTIONS=--max-old-space-size=128

RUN corepack enable && corepack install --global pnpm@10.34.1

# su-exec lets the entrypoint fix volume ownership as root and then drop to the
# unprivileged user before the app starts.
RUN apk add --no-cache su-exec

# -G nodejs matters: without it adduser leaves the account in the default
# group, so the process ran as gid 65533 (nogroup) while /data was chowned to
# the nodejs group. Writes only worked because the owner uid happened to match,
# and anything relying on group permissions would have failed for no visible
# reason.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 -G nodejs nextjs

# Uploads live on a mounted volume so they survive container replacement. The
# mount point is created here for the no-volume case; when a host directory is
# bind-mounted it arrives root-owned and masks this, so start.sh re-applies
# ownership at boot.
ENV BILLOW_STORAGE_DIR=/data/uploads
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/email/package.json ./packages/email/package.json
COPY packages/shadcn/package.json ./packages/shadcn/package.json
COPY config/eslint-config/package.json ./config/eslint-config/package.json
COPY config/tailwind-config/package.json ./config/tailwind-config/package.json
COPY config/typescript-config/package.json ./config/typescript-config/package.json
COPY config/vitest-config/package.json ./config/vitest-config/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --prod --filter @billow/web... --frozen-lockfile --store-dir /pnpm/store

COPY packages/db/prisma ./packages/db/prisma
COPY packages/db/prisma.config.ts ./packages/db/prisma.config.ts
COPY packages/db/src ./packages/db/src
COPY packages/auth/src ./packages/auth/src
COPY packages/email/src ./packages/email/src
COPY packages/shadcn/src ./packages/shadcn/src
COPY apps/web/scripts ./apps/web/scripts
COPY --from=builder /repo/apps/web/.next ./apps/web/.next
COPY --from=builder /repo/apps/web/public ./apps/web/public
COPY --from=builder /repo/packages/db/generated/prisma ./packages/db/generated/prisma

WORKDIR /repo/apps/web
EXPOSE 3000

CMD ["sh", "scripts/start.sh"]
