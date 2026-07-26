import "server-only";

import { getPrisma } from "@billow/db";
import type { Prisma } from "@billow/db/client";

// The table has no natural bound: every unhandled error persists a row, and
// stack traces can be large. Retention is enforced opportunistically (see
// `maybePruneErrorLog` below) rather than by a scheduled job, since this app
// has no scheduler/cron runner.
export const ERROR_LOG_RETENTION = { maxRows: 500, maxAgeDays: 30 } as const;

// Matches a connection string with embedded credentials (scheme://user:pass@host),
// anywhere inside a larger string — unlike diagnostics.ts's maskConnectionString,
// which only ever masks a value that IS the whole connection string. This is a
// deliberate local copy (not a shared export) so this file doesn't reach into
// diagnostics.ts's ownership.
const CONNECTION_STRING_PATTERN = /(\w+:\/\/)([^\s:@/]+)(?::([^\s@/]*))?@/g;

// A stack trace under a broken loop or a deeply recursive failure can run to
// megabytes; cap what gets persisted so one bad error can't dominate the
// table or the row size.
const MAX_STACK_LENGTH = 10_000;

/** Redact embedded connection-string credentials in free-form error text. */
export function redactSecrets(text: string): string {
  return text.replace(
    CONNECTION_STRING_PATTERN,
    (_match, scheme: string, user: string) => `${scheme}${user}:••••@`,
  );
}

/** Cap a stack trace's length, marking that it was cut off. */
export function truncateStack(
  stack: string,
  maxLength: number = MAX_STACK_LENGTH,
): string {
  return stack.length > maxLength
    ? `${stack.slice(0, maxLength)}\n… [truncated]`
    : stack;
}

// Pruning does two extra queries (a delete-by-age and a count-then-delete
// overflow), so running it on every write would double the query cost of
// every single error just to enforce a limit that only matters once the
// table has actually grown. Sampling a fraction of writes still bounds
// growth quickly under any real error rate (even at one error/minute this
// prunes multiple times an hour) while keeping the common case a single
// insert.
const PRUNE_SAMPLE_RATE = 0.05;

async function pruneErrorLog(): Promise<void> {
  const prisma = getPrisma();
  const cutoff = new Date(
    Date.now() - ERROR_LOG_RETENTION.maxAgeDays * 24 * 60 * 60 * 1000,
  );

  await prisma.errorLog.deleteMany({ where: { createdAt: { lt: cutoff } } });

  const total = await prisma.errorLog.count();
  const overflow = total - ERROR_LOG_RETENTION.maxRows;
  if (overflow <= 0) return;

  const oldest = await prisma.errorLog.findMany({
    orderBy: { id: "asc" },
    take: overflow,
    select: { id: true },
  });
  if (oldest.length === 0) return;

  await prisma.errorLog.deleteMany({
    where: { id: { in: oldest.map((row) => row.id) } },
  });
}

// Persist errors to the database so they can be retrieved via /api/health
// after the fact, rather than relying on ephemeral container logs.
export async function recordError(
  context: string,
  error: unknown,
  meta?: Prisma.InputJsonValue,
) {
  try {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const rawStack = error instanceof Error ? (error.stack ?? null) : null;

    const message = redactSecrets(rawMessage);
    const stack =
      rawStack === null ? null : truncateStack(redactSecrets(rawStack));

    await getPrisma().errorLog.create({
      data: {
        context,
        message,
        stack,
        ...(meta === undefined ? {} : { meta }),
      },
    });

    // Opportunistic retention: never let pruning fail the write it rides in
    // on, and log its own failure separately from a persist failure so the
    // two don't get confused when debugging.
    if (Math.random() < PRUNE_SAMPLE_RATE) {
      try {
        await pruneErrorLog();
      } catch (pruneError) {
        console.error("[error-log] failed to prune old errors", pruneError);
      }
    }
  } catch (persistError) {
    // Never let logging failures cascade (e.g. when the DB itself is the cause).
    console.error("[error-log] failed to persist error", persistError);
  }
}

export async function getRecentErrors(limit = 25) {
  try {
    return await getPrisma().errorLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  } catch (readError) {
    console.error("[error-log] failed to read errors", readError);
    return [];
  }
}
