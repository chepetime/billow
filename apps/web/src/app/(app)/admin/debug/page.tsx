import { headers } from "next/headers";

import { requireSession } from "@billow/auth";
import { collectDiagnostics, type Field } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

export const metadata = { title: "Debug" };

function Section({
  title,
  fields,
  children,
}: {
  title: string;
  fields?: Field[];
  children?: React.ReactNode;
}) {
  const failures = fields?.filter((field) => field.failed).length ?? 0;

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {failures > 0 ? (
          <span className="text-xs font-medium text-destructive">
            {failures} failed
          </span>
        ) : null}
      </header>

      {fields ? (
        <dl className="divide-y">
          {fields.map((field) => (
            <div
              key={field.label}
              className="grid gap-1 px-4 py-2 sm:grid-cols-[240px_1fr] sm:gap-4"
            >
              <dt className="text-sm text-muted-foreground">{field.label}</dt>
              <dd
                className={
                  field.failed
                    ? "font-mono text-sm break-all text-destructive"
                    : "font-mono text-sm break-all"
                }
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children}
    </section>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="border-t px-4 py-2">
      <p className="mb-1 text-xs text-muted-foreground">{title}</p>
      <ul className="font-mono text-xs">
        {items.map((item) => (
          <li
            key={item}
            className={item.startsWith("⚠") ? "text-destructive" : undefined}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function DebugPage() {
  await requireSession();
  const d = await collectDiagnostics(await headers());

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">Debug</h1>
        <p className="text-sm text-muted-foreground">
          Runtime diagnostics. Secret values are masked, but this page still
          exposes internals, so it requires a signed-in session. Machine-readable
          copy at{" "}
          <a
            className="text-primary underline underline-offset-4"
            href="/api/admin/diagnostics"
          >
            /api/admin/diagnostics
          </a>
          .
        </p>
        <p className="text-xs text-muted-foreground">Checked at {d.checkedAt}</p>
      </div>

      <Section title="Application" fields={d.application} />
      <Section title="Auth" fields={d.auth} />
      <Section title="Email" fields={d.email} />

      <Section title="Database" fields={[...d.database.server, ...d.database.counts]}>
        <List title="Migrations (most recent first)" items={d.database.migrations.items} />
        <List title="Connections by state" items={d.database.connections.items} />
        <List title="Largest tables" items={d.database.tables.items} />
      </Section>

      <Section title="Container limits" fields={d.container} />
      <Section title="Storage" fields={d.storage} />
      <Section title="Network" fields={d.network} />
      <Section title="Request and proxy headers" fields={d.request} />
      <Section title="Process" fields={d.process} />
      <Section title="Host" fields={d.host} />

      <Section title={`Environment (${d.env.length})`}>
        <dl className="divide-y">
          {d.env.map((entry) => (
            <div
              key={entry.key}
              className="grid gap-1 px-4 py-2 sm:grid-cols-[300px_1fr] sm:gap-4"
            >
              <dt className="font-mono text-xs text-muted-foreground">
                {entry.key}
              </dt>
              <dd
                className={
                  entry.sensitive
                    ? "font-mono text-xs break-all text-muted-foreground italic"
                    : "font-mono text-xs break-all"
                }
              >
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title={`Recent errors (${d.recentErrors.length})`}>
        {d.recentErrors.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No errors recorded.
          </p>
        ) : (
          <ul className="divide-y">
            {d.recentErrors.map((entry) => (
              <li key={entry.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">{entry.context}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toISOString()}
                  </span>
                </div>
                <p className="mt-1 text-sm break-words text-destructive">
                  {entry.message}
                </p>
                {entry.stack ? (
                  <pre className="mt-1 max-h-40 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
                    {entry.stack}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
