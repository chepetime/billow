import "server-only";

import dns from "node:dns/promises";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import v8 from "node:v8";

import { auth } from "@billow/auth";
import { getAuthEnv } from "@billow/auth/env";
import { getPrisma } from "@billow/db";
import {
  getEmailCapability,
  getPublicEmailSettings,
  resolveEmailOrigin,
} from "@billow/email";
import { getRecentErrors } from "@/lib/error-log";
import { securityHeaders } from "@/lib/security-headers";

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
    return [
      { key: "environment", value: `⚠ ${describe(error)}`, sensitive: false },
    ];
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
    // The app is meant to run as uid 1000 and never as root. Uploads live on a
    // bind mount owned by 1000, and the image no longer has a privileged phase
    // that could repair a mismatch, so the effective user is the first thing to
    // check when writes fail. Reported here rather than only in the boot log,
    // which scrolls away.
    probe("User", () => {
      const uid = process.getuid?.();
      const gid = process.getgid?.();
      if (uid === undefined || gid === undefined) {
        return "(not a POSIX platform)";
      }
      let name = "?";
      try {
        name = os.userInfo().username;
      } catch {
        // No passwd entry for this uid — possible with `--user 1000:1000` on an
        // image whose account was removed. Not an error in itself.
      }
      const warning = uid === 0 ? " — WARNING: running as root" : "";
      return `uid ${uid} gid ${gid} (${name})${warning}`;
    }),
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
    // heap_size_limit is V8's TOTAL ceiling — old space plus new space, code
    // space and so on — not the --max-old-space-size value. With that flag at
    // 128 it reports 320 MB, so reading "heap used 90 of 320" suggests plenty
    // of room when the binding constraint is the 128 MB old generation and the
    // real figure is nearer 70%. Both are shown so the headroom is not
    // overestimated.
    probe("Heap limit", () => {
      const total = Math.round(
        v8.getHeapStatistics().heap_size_limit / 1024 / 1024,
      );
      const cap = /--max-old-space-size[= ](\d+)/.exec(
        `${process.env["NODE_OPTIONS"] ?? ""} ${process.execArgv.join(" ")}`,
      )?.[1];
      // Deliberately not called "the effective limit", which is what this
      // said until a real install disproved it: the cap bounds V8's old
      // space, not the process. scrypt's 64 MB comes from OpenSSL and file
      // buffers from Node, both outside it. That install reported a 128 MB
      // cap, a 224 MB heap limit, and a peak RSS of 245.6 MB — past both.
      // What actually bounds the process is the container memory limit.
      return cap
        ? `${total} MB total (old-space cap ${cap} MB — bounds V8's old space only, not RSS)`
        : `${total} MB total (no old-space cap set)`;
    }),
    probe("External", () => mb(process.memoryUsage().external)),
    probe("ArrayBuffers", () => mb(process.memoryUsage().arrayBuffers)),
    probe("Peak RSS", () => mb(process.resourceUsage().maxRSS * 1024)),
    probe("CPU user", () => `${Math.round(process.cpuUsage().user / 1000)} ms`),
    probe(
      "CPU system",
      () => `${Math.round(process.cpuUsage().system / 1000)} ms`,
    ),
  ]);
}

/**
 * What shape of deployment this is, as opposed to what it should be.
 *
 * The production image ships Next's traced standalone output and contains no
 * pnpm and no `next` CLI, while `pnpm dev:local` runs the same code out of a
 * full node_modules tree. Those two behave differently in ways that are easy to
 * misattribute — a module resolving in development and not in the image is
 * almost always a tracing gap — so the mode is stated rather than inferred.
 */
export function collectRuntime(): Field[] {
  return guard("runtime", () => [
    // The standalone server is `apps/web/server.js`; `next start` runs
    // node_modules/next/dist/bin/next. Read from argv because there is no
    // environment variable that distinguishes them.
    probe("Server entry", () => {
      const argv = process.argv[1] ?? "";
      if (argv.endsWith("server.js")) {
        return `standalone (${argv})`;
      }
      if (argv.includes("next")) {
        return `next CLI (${argv})`;
      }
      return argv || UNAVAILABLE;
    }),
    // Resolved and inlined at build time by next.config.ts — see the comment
    // there for why this is not read from node_modules at runtime.
    probe("Package versions", () => process.env.NEXT_PUBLIC_RUNTIME_VERSIONS),
    // The Prisma CLI is present only so migrations can run at boot, and it is
    // installed separately from the app's dependencies. If those two ever drift
    // apart, migrations run under a different Prisma than the client queries
    // with, which is worth seeing side by side with the versions above.
    probe("Migration CLI", () => {
      const candidates = [
        `${process.cwd()}/../../packages/db/node_modules/prisma/package.json`,
        `${process.cwd()}/packages/db/node_modules/prisma/package.json`,
      ];
      for (const path of candidates) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path, "utf8")) as {
            version?: string;
          };
          return `prisma ${pkg.version ?? "?"}`;
        } catch {}
      }
      return "(not present — migrations run outside this image)";
    }),
  ]);
}

export function collectHost(): Field[] {
  return guard("host", () => [
    probe("Hostname", () => os.hostname()),
    probe("OS", () => `${os.type()} ${os.release()}`),
    probe("Platform", () => `${process.platform}/${process.arch}`),
    probe("CPUs", () => os.cpus().length),
    probe("CPU model", () => os.cpus()[0]?.model),
    probe("Load average", () =>
      os
        .loadavg()
        .map((n) => n.toFixed(2))
        .join(", "),
    ),
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

/**
 * Security posture, reported rather than assumed.
 *
 * None of this is visible from the running app: headers are configured in
 * next.config.ts and rate limits inside the auth instance, so the only way to
 * confirm either was to read the source. Both are stated here so an operator
 * can see what is enforced, and so the deliberate weakenings are on the record
 * next to the protections rather than buried in a comment.
 */
export function collectSecurity(headers: Headers): Field[] {
  return guard("security", () => [
    probe("Response headers", () =>
      securityHeaders.map((h) => h.key).join(", "),
    ),
    probe("CSP", () => {
      const csp = securityHeaders.find(
        (h) => h.key === "Content-Security-Policy",
      )?.value;
      return csp ?? "(not set)";
    }),
    // Absent by design, not by omission. This app is served over plain HTTP at
    // umbrel.local; a cached HSTS pin would force HTTPS for the host and can
    // lock a user out entirely if they later lose the tunnel and fall back to
    // the local address.
    probe("HSTS", () =>
      securityHeaders.some((h) => h.key === "Strict-Transport-Security")
        ? "set"
        : "not set (deliberate — the app is served over plain HTTP)",
    ),
    probe("Auth rate limiting", () => {
      const limit = auth.options.rateLimit;
      if (!limit?.enabled) {
        return "DISABLED";
      }
      const rules = Object.entries(limit.customRules ?? {}).length;
      return `on — ${limit.max}/${limit.window}s general, ${rules} tightened rules`;
    }),
    // In-memory counters reset when the container restarts, which briefly
    // reopens the brute-force window around every update. Worth stating because
    // it is invisible and only matters at exactly the wrong moment.
    probe("Rate limit storage", () => {
      // Not set in the auth config, so this is BetterAuth's default. Reading it
      // off `auth.options` would narrow to the literal config object, which has
      // no `storage` key at all — the absence is the answer.
      const storage =
        (auth.options.rateLimit as { storage?: string } | undefined)?.storage ??
        "memory";
      return storage === "memory"
        ? "memory (counters reset on restart — database storage needs a rateLimit model)"
        : storage;
    }),
    // The CSRF check is only meaningful if this resolves to the host actually
    // being served; deriving it from the request Origin would make it
    // tautological. Shown so the resolved value can be compared with the
    // request section above.
    probe("Trusted origin for this request", () => {
      const proto = headers.get("x-forwarded-proto") ?? "http";
      const host = headers.get("x-forwarded-host") ?? headers.get("host");
      return host ? `${proto}://${host}` : "(no host header)";
    }),
    probe("Trusted origin override", () =>
      process.env.BILLOW_TRUSTED_ORIGINS
        ? `set: ${process.env.BILLOW_TRUSTED_ORIGINS}`
        : "(none — derived from the served host)",
    ),
  ]);
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

/**
 * Outbound email, and specifically why password reset is or is not on offer.
 *
 * The gate is invisible from the outside: an administrator who saved a key but
 * never sent a test message sees no reset link and nothing explaining it. The
 * resolved link origin is included because that is the other half of the same
 * question — better-auth builds its links from the in-container
 * `http://localhost:3000`, so what actually goes into an email is derived from
 * the request or an operator override, and getting it wrong means links that
 * are dead on arrival.
 */
export async function collectEmail(headers: Headers): Promise<Field[]> {
  return [
    // States its own result only. The cause is on "Password reset offered"
    // below, which knows the difference between a missing key and one that
    // will not decrypt; guessing here contradicted the line under it.
    await probeAsync("Configured", async () => {
      const { configured } = await getEmailCapability();
      return configured ? "yes" : "no";
    }),
    await probeAsync("Verified by a delivered test", async () => {
      const { verified } = await getEmailCapability();
      return verified ? "yes" : "no";
    }),
    await probeAsync("Password reset offered", async () => {
      const { canSendUserEmail, blockedReason } = await getEmailCapability();
      return canSendUserEmail ? "yes" : `no — ${blockedReason}`;
    }),
    await probeAsync("Provider", async () => {
      const { provider } = await getPublicEmailSettings();
      return provider;
    }),
    await probeAsync("Sender address", async () => {
      const { fromEmail } = await getPublicEmailSettings();
      return fromEmail ?? "(not set)";
    }),
    await probeAsync("Stored key", async () => {
      const { apiKeyHint, credentialError } = await getPublicEmailSettings();
      if (credentialError) return `⚠ ${credentialError}`;
      return apiKeyHint ?? "(none)";
    }),
    await probeAsync("Last verified", async () => {
      const { verifiedAt } = await getPublicEmailSettings();
      return verifiedAt ?? "never";
    }),
    await probeAsync("Public URL override", async () => {
      const { publicUrl } = await getPublicEmailSettings();
      return publicUrl ?? "(none — links use the request's own origin)";
    }),
    await probeAsync("Link origin for this request", async () => {
      const { publicUrl } = await getPublicEmailSettings();
      return (
        resolveEmailOrigin(publicUrl, headers) ??
        "⚠ none resolvable — emails with links would be refused rather than sent dead"
      );
    }),
  ];
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
      cgroupBytes(
        "/sys/fs/cgroup/memory.max",
        "/sys/fs/cgroup/memory/memory.limit_in_bytes",
      ),
    ),
    probe("Memory in use (cgroup)", () =>
      cgroupBytes(
        "/sys/fs/cgroup/memory.current",
        "/sys/fs/cgroup/memory/memory.usage_in_bytes",
      ),
    ),
    probe("Memory peak (cgroup)", () =>
      cgroupBytes(
        "/sys/fs/cgroup/memory.peak",
        "/sys/fs/cgroup/memory/memory.max_usage_in_bytes",
      ),
    ),
    probe("CPU limit (cgroup)", () => {
      const raw = readFirstLine("/sys/fs/cgroup/cpu.max");
      if (!raw) return "unavailable";
      const [quota, period] = raw.split(/\s+/);
      return quota === "max"
        ? "unlimited"
        : `${Number(quota) / Number(period)} cores`;
    }),
    probe("Timezone", () => Intl.DateTimeFormat().resolvedOptions().timeZone),
    probe("Container clock", () => new Date().toISOString()),
    probe(
      "Clock note",
      () => "TOTP two-factor fails if this drifts from real time",
    ),
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
    probe(
      "Nameservers",
      () =>
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

/**
 * How many filesystem entries a storage scan visits before it gives up.
 * Uploads live in per-user subdirectories that grow without bound between
 * diagnostics requests, and this runs on demand on a Raspberry Pi's SD card
 * — an unbounded recursive walk would turn the diagnostics page itself into
 * a denial-of-service. The number is generous enough to cover a real
 * single-tenant install's uploads while keeping worst-case wall time
 * bounded; the cap is a parameter, not a magic constant, so a test can prove
 * truncation without creating thousands of files.
 */
export const STORAGE_SCAN_ENTRY_LIMIT = 20_000;

/**
 * How many directory levels deep a storage scan follows. The storage layout
 * (`storage.ts`) is `<userId>/<uuid>.<ext>` — two levels — so this is
 * headroom against an unexpected layout, not a value tuned to the current
 * convention.
 */
export const STORAGE_SCAN_MAX_DEPTH = 8;

export type StorageUsage = {
  files: number;
  bytes: number;
  truncated: boolean;
};

/**
 * Recursively sums file count and bytes under `dir`. Bounded on two axes —
 * total entries visited and recursion depth — because the storage root's
 * per-user subdirectories are outside this process's control and could in
 * principle be arbitrarily large or deep.
 *
 * Symlinks are never followed: `entry.isSymbolicLink()` reports the
 * directory entry's own type without resolving the link, so a link planted
 * (or accidentally left) inside the storage root is skipped rather than
 * sending the walk wandering the rest of the filesystem. A single
 * unreadable directory or file — permission error, or removed mid-scan — is
 * skipped rather than aborting the scan, so one bad entry can't take down
 * the whole diagnostics page.
 */
export async function scanStorageUsage(
  dir: string,
  limit = STORAGE_SCAN_ENTRY_LIMIT,
  maxDepth = STORAGE_SCAN_MAX_DEPTH,
): Promise<StorageUsage> {
  let files = 0;
  let bytes = 0;
  let visited = 0;
  let truncated = false;

  async function walk(current: string, depth: number): Promise<void> {
    if (truncated) return;
    if (depth > maxDepth) {
      truncated = true;
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (truncated) return;
      if (visited >= limit) {
        truncated = true;
        return;
      }
      visited += 1;

      if (entry.isSymbolicLink()) continue;

      const entryPath = `${current}/${entry.name}`;
      try {
        if (entry.isDirectory()) {
          await walk(entryPath, depth + 1);
        } else if (entry.isFile()) {
          // stat before counting: a file that can't be stat'd (permission
          // error, removed mid-scan) has no known size, so it is skipped
          // rather than counted with a phantom size of zero.
          const size = (await fsp.stat(entryPath)).size;
          files += 1;
          bytes += size;
        }
      } catch {
        // One unreadable or vanished entry must not abort the whole scan.
      }
    }
  }

  await walk(dir, 0);
  return { files, bytes, truncated };
}

/**
 * The uploads volume. Only Postgres used to persist, so this section answers
 * the question that matters after an update: did the mount actually arrive,
 * and can the unprivileged runtime user write to it?
 */
export async function collectStorage(): Promise<Field[]> {
  const dir = process.env.BILLOW_STORAGE_DIR ?? "/data/uploads";

  const fields = [
    probe("Directory", () => dir),
    probe("Exists", () => (fs.existsSync(dir) ? "yes" : "no")),
    probe("Owner / mode", () => {
      const stat = fs.statSync(dir);
      return `uid ${stat.uid}:gid ${stat.gid} ${(stat.mode & 0o777).toString(8)}`;
    }),
    probe("Mounted volume", () =>
      // A bind mount shows a different device id than the parent directory.
      fs.statSync(dir).dev !== fs.statSync("/").dev
        ? "yes (separate device)"
        : "no (container filesystem — data is lost on update)",
    ),
  ];

  const writable = await probeAsync("Writable by app user", async () => {
    const probeFile = `${dir}/.write-probe`;
    await fsp.writeFile(probeFile, "ok");
    await fsp.unlink(probeFile);
    return "yes";
  });

  const usage = await probeAsync("Files / bytes used", async () => {
    const { files, bytes, truncated } = await scanStorageUsage(dir);
    // A silently capped number is worse than an honest one: an operator who
    // sees "20000 files" with no caveat will trust it as the real count.
    return truncated
      ? `${files} / ${mb(bytes)} (truncated at ${STORAGE_SCAN_ENTRY_LIMIT} entries — actual usage is higher)`
      : `${files} / ${mb(bytes)}`;
  });

  const free = await probeAsync("Free on that device", async () => {
    const stat = await fsp.statfs(dir);
    return mb(stat.bavail * stat.bsize);
  });

  return [...fields, writable, usage, free];
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
      prisma().$queryRawUnsafe<
        { migration_name: string; finished_at: Date | null }[]
      >(
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
  const [
    databaseResult,
    errorsResult,
    networkResult,
    storageResult,
    emailResult,
  ] = await Promise.allSettled([
    collectDatabase(),
    safeRecentErrors(),
    collectNetwork(),
    collectStorage(),
    collectEmail(headers),
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
    runtime: collectRuntime(),
    process: collectProcess(),
    host: collectHost(),
    container: collectContainer(),
    storage:
      storageResult.status === "fulfilled"
        ? storageResult.value
        : [
            {
              label: "storage",
              value: `⚠ ${describe(storageResult.reason)}`,
              failed: true,
            },
          ],
    network,
    request: collectRequest(headers),
    auth: collectAuth(),
    security: collectSecurity(headers),
    email:
      emailResult.status === "fulfilled"
        ? emailResult.value
        : [
            {
              label: "email",
              value: `⚠ ${describe(emailResult.reason)}`,
              failed: true,
            },
          ],
    database,
    env: collectEnv(),
    recentErrors,
  };
}

export type Diagnostics = Awaited<ReturnType<typeof collectDiagnostics>>;
