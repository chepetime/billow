import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@billow/db"],
};

export default nextConfig;
