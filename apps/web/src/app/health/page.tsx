import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { getAuthEnv } from "@/lib/auth-env";
import { getRecentErrors } from "@/lib/error-log";
import { getPrisma } from "@billow/db";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUptime(seconds: number) {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor((seconds / 3600) % 24);
  const d = Math.floor(seconds / 86400);
  return [d ? `${d}d` : null, h ? `${h}h` : null, m ? `${m}m` : null, `${s}s`]
    .filter(Boolean)
    .join(" ");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadDatabase() {
  try {
    const userCount = await getPrisma().user.count();
    return { ok: true as const, userCount };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

async function loadSession() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    return { ok: true as const, session };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

function loadAuthEnv() {
  try {
    const env = getAuthEnv(process.env);
    return {
      ok: true as const,
      baseUrl: env.baseUrl,
      secretConfigured: env.secret.length >= 32,
    };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[200px_1fr] sm:gap-6 sm:px-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{value}</dd>
    </div>
  );
}

function Section({
  title,
  ok,
  children,
}: {
  title: string;
  ok?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5 sm:px-5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {ok === undefined ? null : (
          <span
            className={
              ok
                ? "text-xs font-medium text-muted-foreground"
                : "text-xs font-medium text-destructive"
            }
          >
            {ok ? "OK" : "ERROR"}
          </span>
        )}
      </header>
      <dl className="divide-y">{children}</dl>
    </section>
  );
}

export default async function HealthPage() {
  const [database, session] = await Promise.all([loadDatabase(), loadSession()]);
  const authEnv = loadAuthEnv();
  const memory = process.memoryUsage();
  const recentErrors = await getRecentErrors(10);
  const overallOk = database.ok && session.ok && authEnv.ok;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10 sm:px-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-normal">Health</h1>
        <span
          className={
            overallOk
              ? "text-sm font-medium text-muted-foreground"
              : "text-sm font-medium text-destructive"
          }
        >
          {overallOk ? "All systems OK" : "Attention needed"}
        </span>
      </div>

      <Section title="App">
        <Row label="Version" value={process.env.NEXT_PUBLIC_APP_VERSION ?? "—"} />
        <Row label="Environment" value={process.env.NODE_ENV ?? "—"} />
        <Row label="Node" value={process.version} />
        <Row label="Checked at" value={new Date().toISOString()} />
      </Section>

      <Section title="Runtime">
        <Row label="Uptime" value={formatUptime(process.uptime())} />
        <Row label="Memory (RSS)" value={formatBytes(memory.rss)} />
        <Row
          label="Heap"
          value={`${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}`}
        />
      </Section>

      <Section title="Database" ok={database.ok}>
        {database.ok ? (
          <Row label="Users" value={database.userCount} />
        ) : (
          <Row label="Error" value={database.error} />
        )}
      </Section>

      <Section title="Auth" ok={authEnv.ok}>
        {authEnv.ok ? (
          <>
            <Row label="Base URL" value={authEnv.baseUrl} />
            <Row
              label="Secret configured"
              value={authEnv.secretConfigured ? "yes" : "no"}
            />
          </>
        ) : (
          <Row label="Error" value={authEnv.error} />
        )}
      </Section>

      <Section title="Session" ok={session.ok}>
        {!session.ok ? (
          <Row label="Error" value={session.error} />
        ) : session.session ? (
          <>
            <Row label="Signed in" value="yes" />
            <Row label="User" value={session.session.user.email} />
          </>
        ) : (
          <Row label="Signed in" value="no" />
        )}
      </Section>

      <Section title={`Recent errors (${recentErrors.length})`}>
        {recentErrors.length === 0 ? (
          <Row label="None" value="No errors recorded." />
        ) : (
          recentErrors.map((entry) => (
            <div key={entry.id} className="px-4 py-2.5 sm:px-5">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">{entry.context}</span>
                <span className="text-xs text-muted-foreground">
                  {entry.createdAt.toISOString()}
                </span>
              </div>
              <p className="mt-1 text-sm break-words text-destructive">
                {entry.message}
              </p>
            </div>
          ))
        )}
      </Section>
    </main>
  );
}
