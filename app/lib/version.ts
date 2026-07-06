// Single source of truth for the app version + build metadata.
//
// Because next.config.ts uses output: "standalone", package.json is absent at
// runtime — so these values must be baked in at BUILD time. `version` is inlined
// from package.json when `npm run build` runs (resolveJsonModule); `gitSha` and
// `buildTime` come from NEXT_PUBLIC_* env vars (fed by Docker build ARGs), with
// dev/empty fallbacks. The NEXT_PUBLIC_ prefix lets the same constant resolve in
// client bundles (e.g. the sidebar badge) and server code (e.g. /api/health), so
// the two can never disagree.
//
// NOTE (#171, client badge): when this module is imported into a *client*
// component, the bundler may inline the whole package.json. Reference only
// `pkg.version` (as below) and verify the client bundle doesn't ship the rest.
import pkg from "@/package.json";

export const BUILD_INFO = {
  version: pkg.version,
  gitSha: process.env.NEXT_PUBLIC_GIT_SHA || "dev",
  buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || "",
} as const;
