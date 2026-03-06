import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained build at .next/standalone that bundles only
  // the necessary node_modules. Required for the multi-stage Docker image
  // defined in Issue #18.
  output: "standalone",
};

export default nextConfig;
