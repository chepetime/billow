import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/security-headers";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

const appDir = dirname(fileURLToPath(import.meta.url));

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

export default nextConfig;
