FROM node:22-alpine AS deps

WORKDIR /repo

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder

WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN pnpm --filter @billow/web build

FROM node:22-alpine AS runner

WORKDIR /repo
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000

RUN corepack enable

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --prod --frozen-lockfile

COPY apps/web/prisma ./apps/web/prisma
COPY apps/web/prisma.config.ts ./apps/web/prisma.config.ts
COPY apps/web/scripts ./apps/web/scripts
COPY --from=builder /repo/apps/web/.next ./apps/web/.next
COPY --from=builder /repo/apps/web/public ./apps/web/public
COPY --from=builder /repo/apps/web/src/generated/prisma ./apps/web/src/generated/prisma

USER nextjs

WORKDIR /repo/apps/web
EXPOSE 3000

CMD ["sh", "scripts/start.sh"]
