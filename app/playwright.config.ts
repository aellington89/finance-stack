import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

import { STORAGE_STATE } from "./e2e/fixtures/constants";

// Same file the integration project reads, and for the same reason: DATABASE_URL
// and AUTH_SECRET live there locally. dotenv does not override variables that
// are already set, so a CI job's environment still wins.
loadEnv({ path: resolve(__dirname, ".env.local") });

// Not 3001 and not 3002. 3001 is the port the `start` script and the
// finance-app container both bind, so a suite on that port either fights the
// running stack or — worse — passes by testing it instead of the build under
// test. 3002 is taken by the deploy/dev verification flow.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",

  // The suite drives one database and asserts on a global aggregate (Net
  // Worth), so a second worker would be a second writer racing the assertion.
  workers: 1,
  fullyParallel: false,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  // The money path is ~8 navigations of `force-dynamic` pages, each of which
  // runs real aggregate SQL. The 30s default is tight enough to fail on a slow
  // CI runner rather than on a defect.
  timeout: 90_000,
  expect: { timeout: 10_000 },

  // list for the CI log, html for the artifact the e2e job uploads on failure.
  // `open: never` so a local failure does not launch a browser mid-run.
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],

  // The production build, not `next dev`. Turbopack compiles a route on first
  // hit — slower and flakier — the dev CSP differs from the shipped one
  // ('unsafe-eval', ws: in next.config.ts), and the point of an E2E gate is to
  // exercise what ships. `npx next start` rather than `npm run start`, because
  // that script hardcodes -p 3001 and a second -p would leave the winning port
  // up to the argument parser.
  //
  // `next start` prints "does not work with output: standalone" and then works:
  // next.config.ts sets output: standalone for the Docker image, and the notice
  // is deployment advice, not a failure. Verified — it serves the pages and
  // /_next/static assets from the same build. Running .next/standalone/server.js
  // instead would additionally need .next/static copied into it by hand, which
  // is a step the Dockerfile owns and this config should not duplicate.
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    // /api/health is outside the proxy matcher and needs no session, so it is
    // readiness rather than a redirect to /login. It answers 503 while the
    // database is unreachable, which keeps Playwright waiting instead of
    // starting a suite that would fail on every page.
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "",
    },
  },
});
