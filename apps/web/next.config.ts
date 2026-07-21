import { readFileSync } from "node:fs";

import type { NextConfig } from "next";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

const nextConfig: NextConfig = {
  transpilePackages: ["@billow/db"],
  env: {
    // Release version, inlined at build time from package.json (bumped
    // before tagging a release). Reliable regardless of DB seeding.
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
