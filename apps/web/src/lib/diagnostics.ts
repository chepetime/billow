import "server-only";

import dns from "node:dns/promises";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import v8 from "node:v8";

import { getAuthEnv } from "@/lib/auth-env";
import { getRecentErrors } from "@/lib/error-log";
import { getPrisma } from "@billow/db";

/**
 * Diagnostics are only ever rendered behind a session: they include
 * environment keys, request headers, database internals, and stack traces.
 * The public surface is the boolean liveness check in /api/health.
 *
 * Every field is collected through `probe`/`probeAsync`, so a single failing
 * lookup renders as a visible error string instead of taking down the page.
 * A value is therefore always either real or a known error.
 */

const SENSITIVE_KEY =
  /SECRET|PASSWORD|TOKEN|_KEY|APIKEY|SEED|CREDENTIAL|AUTH|SESSION|COOKIE/i;

export type Field = { label: string; value: string; failed: boolean };

const UNAVAILABLE = "unavailable";

function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

function present(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.length === 0 ? null : text;
}

/** Synchronous field: real value, `unavailable`, or the thrown message. */
export function probe(label: string, get: () => unknown): Field {
  try {
    const value = present(get());
    return value === null
      ? { label, value: UNAVAILABLE, failed: false }
      : { label, value, failed: false };
  } catch (error) {
    return { label, value: `⚠ ${describe(error)}`, failed: true };
  }
}

/** Asynchronous field, with the same guarantees as `probe`. */
export async function probeAsync(
  label: string,
  get: () => Promise<unknown>,
): Promise<Field> {
  try {
    const value = present(await get());
    return value === null
      ? { label, value: UNAVAILABLE, failed: false }
      : { label, value, failed: false };
  } catch (error) {
    return { label, value: `⚠ ${describe(error)}`, failed: true };
  }
}

/** Collect a list safely; a failure becomes a single explanatory row. */
async function probeList<T>(
  get: () => Promise<T[]>,
  render: (row: T) => string,
): Promise<{ items: string[]; failed: boolean }> {
  try {
    const rows = await get();
    return rows.length
      ? { items: rows.map(render), failed: false }
      : { items: ["(none)"], failed: false };
  } catch (error) {
    return { items: [`⚠ ${describe(error)}`], failed: true };
  }
}

/** Wrap a whole collector so it can never throw; failure becomes one row. */
function guard(label: string, get: () => Field[]): Field[] {
  try {
    return get();
  } catch (error) {
    return [{ label, value: `⚠ ${describe(error)}`, failed: true }];
  }
}

export function maskConnectionString(value: string): string {
  return value.replace(
    /^(\w+:\/\/)([^:@/]+)(?::([^@/]*))?@/,
    (_match, scheme: string, user: string) => `${scheme}${user}:••••@`,
  );
}

function maskValue(key: string, value: string): string {
  if (/^\w+:\/\/[^@/]+@/.test(value)) return maskConnectionString(value);
  if (SENSITIVE_KEY.test(key)) return `•••• (${value.length} chars)`;
  return value;
}

export type EnvEntry = { key: string; value: string; sensitive: boolean };

export function collectEnv(env: NodeJS.ProcessEnv = process.env): EnvEntry[] {
  try {
    const skip = /^(npm_|PATH$|HOME$|PWD$|SHLVL$|_$|YARN_|__)/;
    return Object.keys(env)
      .filter((key) => !skip.test(key))
      .sort()
      .map((key) => {
        const raw = env[key] ?? "";
        return {
          key,
          value: maskValue(key, raw),
          sensitive: SENSITIVE_KEY.test(key) || /^\w+:\/\/[^@/]+@/.test(raw),
        };
      });
  } catch (error) {
    return [{ key: "environment", value: `⚠ ${describe(error)}`, sensitive: false }];
  }
}

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function duration(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds / 3600) % 24);
  const m = Math.floor((seconds / 60) % 60);
  const s = Math.floor(seconds % 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`]
    .filter(Boolean)
    .join(" ");
}

export function collectApplication(): Field[] {
  return guard("application", () => [
    probe("Version", () => process.env.NEXT_PUBLIC_APP_VERSION),
    probe("Environment", () => process.env.NODE_ENV),
    probe("Next runtime", () => process.env.NEXT_RUNTIME ?? "nodejs"),
    probe("Uptime", () => duration(process.uptime())),
    probe("NODE_OPTIONS", () => process.env.NODE_OPTIONS ?? "(default)"),
  ]);
}

export function collectProcess(): Field[] {
  return guard("process", () => [
    probe("PID / PPID", () => `${process.pid} / ${process.ppid}`),
    probe("Node", () => process.version),
    probe("V8", () => process.versions.v8),
    probe("libuv", () => process.versions.uv),
    probe("OpenSSL", () => process.versions.openssl),
    probe("Exec path", () => process.execPath),
    probe("Working directory", () => process.cwd()),
    probe("Argv", () => process.argv.join(" ")),
    probe("RSS", () => mb(process.memoryUsage().rss)),
    probe("Heap used", () => mb(process.memoryUsage().heapUsed)),
    probe("Heap total", () => mb(process.memoryUsage().heapTotal)),
    probe("Heap limit", () =>
      `${Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024)} MB`,
    ),
    probe("External", () => mb(process.memoryUsage().external)),
    probe("ArrayBuffers", () => mb(process.memoryUsage().arrayBuffers)),
    probe("Peak RSS", () => mb(process.resourceUsage().maxRSS * 1024)),
    probe("CPU user", () => `${Math.round(process.cpuUsage().user / 1000)} ms`),
    probe("CPU system", () => `${Math.round(process.cpuUsage().system / 1000)} ms`),
  ]);
}

export function collectHost(): Field[] {
  return guard("host", () => [
    probe("Hostname", () => os.hostname()),
    probe("OS", () => `${os.type()} ${os.release()}`),
    probe("Platform", () => `${process.platform}/${process.arch}`),
    probe("CPUs", () => os.cpus().length),
    probe("CPU model", () => os.cpus()[0]?.model),
    probe("Load average", () => os.loadavg().map((n) => n.toFixed(2)).join(", ")),
    probe("Memory free", () => mb(os.freemem())),
    probe("Memory total", () => mb(os.totalmem())),
    probe("Host uptime", () => duration(os.uptime())),
    probe("Containerized", () =>
      process.env.HOSTNAME && process.env.PORT ? "yes" : "no",
    ),
  ]);
}

/**
 * What the app actually receives after any reverse proxy — the section that
 * settles "works on umbrel.local but not over Tailscale" style problems.
 */
export function collectRequest(headers: Headers): Field[] {
  const names = [
    "host",
    "origin",
    "referer",
    "user-agent",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-forwarded-for",
    "x-forwarded-port",
    "x-real-ip",
    "forwarded",
    "cf-connecting-ip",
    "cf-visitor",
  ];

  return guard("request", () =>
    names.map((name) => probe(name, () => headers.get(name) ?? "(absent)")),
  );
}

export function collectAuth(): Field[] {
  const env = () => getAuthEnv(process.env);

  return guard("auth", () => [
    probe("Base URL", () => env().baseUrl),
    probe("Base URL pinned", () =>
      process.env.BETTER_AUTH_URL ? "yes" : "no (inferred per request)",
    ),
    probe("Secret configured", () =>
      env().secret.length >= 32 ? `yes (${env().secret.length} chars)` : "NO",
    ),
    probe("Plugins", () => "username, twoFactor, apiKey, openAPI"),
  ]);
}


function readFirstLine(path: string): string | null {
  try {
    return fs.readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

/** cgroup limits are what Docker/Umbrel actually enforce. */
function cgroupBytes(v2: string, v1: string): string {
  const raw = readFirstLine(v2) ?? readFirstLine(v1);
  if (raw === null) return "unavailable";
  if (raw === "max") return "unlimited";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  // cgroup v1 reports an enormous sentinel when unconstrained.
  if (n > 1e15) return "unlimited";
  return mb(n);
}

/**
 * Container limits and identity. `os.totalmem()` reports the HOST's memory
 * even inside a constrained container, so the cgroup values below are the
 * only trustworthy view of what this app may actually use.
 */
export function collectContainer(): Field[] {
  return guard("container", () => [
    probe("In a container", () =>
      fs.existsSync("/.dockerenv") ? "yes (/.dockerenv)" : "no",
    ),
    probe("Container hostname", () => os.hostname()),
    probe("Memory limit (cgroup)", () =>
      cgroupBytes("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"),
    ),
    probe("Memory in use (cgroup)", () =>
      cgroupBytes("/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"),
    ),
    probe("Memory peak (cgroup)", () =>
      cgroupBytes("/sys/fs/cgroup/memory.peak", "/sys/fs/cgroup/memory/memory.max_usage_in_bytes"),
    ),
    probe("CPU limit (cgroup)", () => {
      const raw = readFirstLine("/sys/fs/cgroup/cpu.max");
      if (!raw) return "unavailable";
      const [quota, period] = raw.split(/\s+/);
      return quota === "max" ? "unlimited" : `${Number(quota) / Number(period)} cores`;
    }),
    probe("Timezone", () => Intl.DateTimeFormat().resolvedOptions().timeZone),
    probe("Container clock", () => new Date().toISOString()),
    probe("Clock note", () => "TOTP two-factor fails if this drifts from real time"),
  ]);
}

/**
 * Networking as the container sees it. Umbrel puts every app on one shared
 * network, so confirming which container a hostname resolves to is the
 * fastest way to catch a name collision.
 */
export async function collectNetwork(): Promise<Field[]> {
  const dbHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();

  const fields = [
    probe("Database hostname", () => dbHost || "unavailable"),
    probe("Nameservers", () =>
      (readFirstLine("/etc/resolv.conf") ?? "")
        .split("\n")
        .filter((l) => l.startsWith("nameserver"))
        .join(" ") || dns.getServers().join(", "),
    ),
    probe("Interfaces", () =>
      Object.entries(os.networkInterfaces())
        .flatMap(([name, addrs]) =>
          (addrs ?? [])
            .filter((a) => a.family === "IPv4")
            .map((a) => `${name}=${a.address}`),
        )
        .join(", "),
    ),
  ];

  const resolved = await probeAsync("Database resolves to", async () => {
    if (!dbHost) return "unavailable";
    const records = await dns.lookup(dbHost, { all: true });
    return records.map((r) => r.address).join(", ");
  });

  const disk = await probeAsync("Disk free / total", async () => {
    const stat = await fsp.statfs("/");
    return `${mb(stat.bavail * stat.bsize)} / ${mb(stat.blocks * stat.bsize)}`;
  });

  return [...fields, resolved, disk];
}

export async function collectDatabase() {
  // Resolved lazily inside each probe: if the client itself cannot be
  // constructed (missing DATABASE_URL, bad credentials) that surfaces as a
  // per-field error instead of throwing the whole section away.
  const prisma = () => getPrisma();

  const counts = await Promise.all([
    probeAsync("Users", () => prisma().user.count()),
    probeAsync("Sessions", () => prisma().session.count()),
    probeAsync("Accounts", () => prisma().account.count()),
    probeAsync("API keys", () => prisma().apikey.count()),
    probeAsync("Two-factor records", () => prisma().twoFactor.count()),
    probeAsync("Invoices", () => prisma().invoice.count()),
    probeAsync("Clients", () => prisma().clientCompany.count()),
    probeAsync("Error log rows", () => prisma().errorLog.count()),
  ]);

  const server = await Promise.all([
    probeAsync("Reachable", async () => {
      const started = Date.now();
      await prisma().$queryRaw`SELECT 1`;
      return `yes (${Date.now() - started} ms)`;
    }),
    probeAsync("Server version", async () => {
      const [row] = await prisma().$queryRawUnsafe<{ version: string }[]>(
        "SELECT version() AS version",
      );
      return row?.version.split(",")[0];
    }),
    probeAsync("Database", async () => {
      const [row] = await prisma().$queryRawUnsafe<{ name: string }[]>(
        "SELECT current_database() AS name",
      );
      return row?.name;
    }),
    probeAsync("Connected as", async () => {
      const [row] = await prisma().$queryRawUnsafe<{ name: string }[]>(
        "SELECT current_user AS name",
      );
      return row?.name;
    }),
    probeAsync("Size on disk", async () => {
      const [row] = await prisma().$queryRawUnsafe<{ size: string }[]>(
        "SELECT pg_size_pretty(pg_database_size(current_database())) AS size",
      );
      return row?.size;
    }),
    probeAsync("Connection host", () =>
      Promise.resolve(
        maskConnectionString(process.env.DATABASE_URL ?? "").split("@")[1] ??
          UNAVAILABLE,
      ),
    ),
  ]);

  const migrations = await probeList(
    () =>
      prisma().$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
        "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 15",
      ),
    (row) => `${row.finished_at ? "✓" : "✗ pending"} ${row.migration_name}`,
  );

  const connections = await probeList(
    () =>
      prisma().$queryRawUnsafe<{ state: string | null; count: bigint }[]>(
        "SELECT state, count(*) AS count FROM pg_stat_activity WHERE datname = current_database() GROUP BY state",
      ),
    (row) => `${row.state ?? "unknown"}: ${Number(row.count)}`,
  );

  const tables = await probeList(
    () =>
      prisma().$queryRawUnsafe<{ name: string; size: string }[]>(
        `SELECT relname AS name, pg_size_pretty(pg_total_relation_size(relid)) AS size
         FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15`,
      ),
    (row) => `${row.name} — ${row.size}`,
  );

  return { server, counts, migrations, connections, tables };
}

async function safeRecentErrors() {
  try {
    return await getRecentErrors(50);
  } catch {
    return [];
  }
}

const emptyDatabase = () => ({
  server: [] as Field[],
  counts: [] as Field[],
  migrations: { items: ["⚠ not collected"], failed: true },
  connections: { items: ["⚠ not collected"], failed: true },
  tables: { items: ["⚠ not collected"], failed: true },
});

export async function collectDiagnostics(headers: Headers) {
  // Settled, not all: one rejected collector must not lose the whole report.
  const [databaseResult, errorsResult, networkResult] = await Promise.allSettled([
    collectDatabase(),
    safeRecentErrors(),
    collectNetwork(),
  ]);

  const database =
    databaseResult.status === "fulfilled"
      ? databaseResult.value
      : {
          ...emptyDatabase(),
          server: [
            {
              label: "database",
              value: `⚠ ${describe(databaseResult.reason)}`,
              failed: true,
            },
          ],
        };
  const recentErrors =
    errorsResult.status === "fulfilled" ? errorsResult.value : [];
  const network: Field[] =
    networkResult.status === "fulfilled"
      ? networkResult.value
      : [
          {
            label: "network",
            value: `⚠ ${describe(networkResult.reason)}`,
            failed: true,
          },
        ];

  return {
    checkedAt: new Date().toISOString(),
    application: collectApplication(),
    process: collectProcess(),
    host: collectHost(),
    container: collectContainer(),
    network,
    request: collectRequest(headers),
    auth: collectAuth(),
    database,
    env: collectEnv(),
    recentErrors,
  };
}

export type Diagnostics = Awaited<ReturnType<typeof collectDiagnostics>>;
