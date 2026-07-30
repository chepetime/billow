import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { securityHeaders } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

const appDir = dirname(fileURLToPath(import.meta.url));

/**
 * Installed versions of the dependencies most likely to be implicated in a
 * production problem, resolved here and inlined for the diagnostics page.
 *
 * Resolved at build time on purpose. Doing it at runtime would mean requiring a
 * package.json by a computed path, which webpack cannot trace and which behaves
 * differently in the standalone bundle than in a dev tree. This config runs in
 * plain Node, so ordinary resolution works and records the version actually
 * installed rather than the range the manifest asks for.
 */
const require = createRequire(import.meta.url);

/**
 * A package's installed version.
 *
 * Two strategies, because neither works alone. Requiring `<name>/package.json`
 * is the direct route but fails on any package whose `exports` map does not
 * list it — better-auth is one, and it reported "unresolved" until this
 * fallback existed. So on failure, resolve the package's entry point and walk
 * up to the nearest package.json that actually names it, which works
 * regardless of the exports map.
 */
function installedVersion(name: string): string {
  try {
    const pkg = require(`${name}/package.json`) as { version?: string };
    return pkg.version ?? "?";
  } catch {
    // Fall through to the entry-point walk.
  }

  try {
    let dir = dirname(require.resolve(name));
    // Bounded by reaching the filesystem root, where dirname is a fixed point.
    for (let depth = 0; depth < 20; depth += 1) {
      const candidate = join(dir, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === name) {
          return pkg.version ?? "?";
        }
      } catch {
        // No package.json at this level, or unreadable — keep walking.
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Not resolvable at all.
  }

  return "unresolved";
}

const runtimeVersions = ["next", "@prisma/client", "better-auth"]
  .map((name) => `${name} ${installedVersion(name)}`)
  .join(", ");

const nextConfig: NextConfig = {
  // Emit `.next/standalone`: a self-contained server plus only the
  // `node_modules` files tracing proved are reachable. The production image
  // otherwise has to `pnpm install --prod` the whole dependency graph, which
  // is the bulk of its ~1.9 GB.
  output: "standalone",
  // Tracing walks up from the app to find the dependency root. In a pnpm
  // workspace the real root is two levels up (packages are symlinked into
  // `<repo>/node_modules/.pnpm`), and without this Next infers `apps/web` and
  // silently omits every hoisted dependency — the image then builds fine and
  // dies at runtime on the first import.
  outputFileTracingRoot: join(appDir, "../.."),
  transpilePackages: ["@billow/auth", "@billow/db", "@billow/shadcn"],
  env: {
    // Release version, inlined at build time from package.json (bumped
    // before tagging a release). Reliable regardless of DB seeding.
    NEXT_PUBLIC_APP_VERSION: version,
    // Shown on the diagnostics page; see runtimeVersions above.
    NEXT_PUBLIC_RUNTIME_VERSIONS: runtimeVersions,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

// Wires src/i18n/request.ts in as the per-request locale/message source. The
// plugin also makes `messages/*.json` part of the build, which matters for the
// standalone output: dynamically imported JSON is only traced because this
// tells Next where it lives.
export default withNextIntl(nextConfig);
