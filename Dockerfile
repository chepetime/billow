FROM node:22-alpine AS deps

WORKDIR /app

COPY app/package.json app/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY app ./
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY app/package.json app/package-lock.json ./
COPY app/prisma ./prisma
COPY app/prisma.config.ts ./
RUN npm ci --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY app/scripts ./scripts

USER nextjs

EXPOSE 3000

CMD ["sh", "scripts/start.sh"]
