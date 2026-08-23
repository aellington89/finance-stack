import { defineConfig, coverageConfigDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/setup.ts"],
          setupFiles: ["tests/integration/vitest-setup.ts"],
          fileParallelism: false,
        },
      },
    ],

    // Issue #142. The thresholds at the bottom are the visible half of this
    // block; the include/exclude set above them is the load-bearing half, and
    // it is the one that took the work. A threshold is only as meaningful as
    // the file set it divides by, and the previous set was accidental — see the
    // three notes below for how, because every one of them is a mistake that is
    // easy to make again.
    //
    // Read `include` as "the surface a `*.test.ts` in a node environment can
    // actually reach". Everything the suite cannot execute is excluded and
    // says why. That is a deliberately smaller denominator than "all source":
    // padding it with files no test can run makes the percentage a constant
    // rather than a gate, and a constant cannot detect a regression.
    coverage: {
      provider: "v8",

      // Trap 1: these globs resolve against the vite root (this directory),
      // NOT the repo root. `app/api/health/**` below is app/app/api/health/ on
      // disk. Getting this backwards silently matches nothing, which reads as
      // "that code is uncovered" rather than as a broken pattern.
      include: [
        "lib/**/*.ts",
        // The two routes with real logic, both covered by
        // tests/integration/api/. Deliberately not `app/api/**`, which would
        // also take app/api/auth/[...nextauth]/route.ts — three lines
        // re-exporting `handlers` from auth.ts, which is itself excluded below.
        "app/api/health/**/*.ts",
        "components/**/*.ts",
        "scripts/**/*.ts",
        "instrumentation.ts",
      ],

      exclude: [
        // Spread the defaults rather than replacing them. Vitest merges this
        // config as `{...coverageConfigDefaults, ...config}`, so a bare array
        // here drops **/node_modules/** and every other default guard. Nothing
        // has leaked in yet only because vitest externalises node_modules by
        // default — that is one `server.deps.inline` away from changing.
        ...coverageConfigDefaults.exclude,

        // Trap 2, and the most surprising line in this file: `include` is
        // applied through the provider's isIncluded() with picomatch's
        // `contains: true`, which matches a pattern against any SUBSTRING of
        // the absolute path. So `components/**/*.ts` matches card.tsx — the
        // string "components/ui/card.ts" is a substring of
        // ".../components/ui/card.tsx". Without this line the `*.ts` patterns
        // above quietly pull in the whole React tree.
        //
        // Which they must not, because nothing here can render it: both
        // projects are `environment: node` and collect `*.test.ts` only, so a
        // .tsx file can be imported but never mounted. Those files would sit at
        // whatever fraction of themselves is module-level, forever.
        //
        // The cost is real and was accepted, not overlooked. Five files under
        // tests/unit/components/ exercise pure transforms that happen to be
        // exported FROM .tsx components, so those transforms stop being
        // measured here — the tests still run and still gate behaviour. Issue
        // #296 moves them into sibling .ts modules and adds a jsdom project,
        // which is what makes this exclusion removable.
        "**/*.tsx",

        // The same reason as *.tsx: a React hook with no renderer.
        "hooks/**",

        "**/*.test.ts",
        "drizzle/**",

        // Framework wiring the suite replaces rather than exercises.
        // vitest-setup.ts mocks @/auth wholesale (Issue #120's session gate),
        // so auth.ts can never report anything but 0% however well tested the
        // code that depends on it is.
        "auth.ts",
        "proxy.ts",

        // The pg Pool singleton — construction, no branches worth gating.
        "lib/db/index.ts",

        // argv-parsing and stdout shells. The logic each one wraps lives in a
        // sibling module (check-changelog-core.ts, docs-index-check.ts,
        // release-notes-core.ts, seed-reference-check.ts) which stays in the
        // denominator and sits near 100%. Counting the wrappers adds ~250
        // statements at 0% and gates nothing that the cores do not already.
        "scripts/check-changelog.ts",
        "scripts/check-docs.ts",
        "scripts/check-seed-references.ts",
        "scripts/create-user.ts",
        "scripts/release-notes.ts",
      ],

      // text-summary rather than the default `text`: the full table is ~50 rows
      // and the four-line summary is what a CI log reader wants. html stays for
      // local drill-down, json-summary for anything that wants to read the
      // numbers back. Dropped clover/json from the defaults — nothing consumes
      // them here. app/coverage/ is gitignored.
      reporter: ["text-summary", "html", "json-summary"],

      // Trap 3, and the one that inverts the rule above: threshold globs are
      // matched WITHOUT `contains: true`, against the path relative to this
      // directory. They are anchored, so `lib/**/*.ts` here really does mean
      // .ts only — the opposite of how the same string behaves in `include`.
      //
      // Note also that the global block is not "everything the globs did not
      // match". Vitest evaluates it over every file in the map, glob-matched
      // ones included, so these are four additional assertions rather than a
      // partition.
      //
      // Numbers are the measured baseline minus 2 points, rounded down. Two
      // points absorbs ordinary jitter without absorbing a regression. Raise
      // them when coverage rises — deliberately, in a reviewed diff, which is
      // why thresholds.autoUpdate stays off: it rewrites this file from inside
      // a CI run, and the resulting change has no author and no reason.
      //
      // Baseline measured 2026-08-23 over the merged unit+integration run
      // (743 tests): 87.54 / 77.28 / 85.36 / 88.07. Branches is the weak metric
      // across every glob and the one to watch.
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 83,
        lines: 86,

        // 85.5 / 73.8 / 82.7 / 86.2. Most of this is earned by the integration
        // project, not the unit one: lib/queries and lib/actions are ~840
        // statements that sit near 5% on a `--project unit` run.
        "lib/**/*.ts": { statements: 83, branches: 71, functions: 80, lines: 84 },

        // 99.6 / 93.0 / 100 / 99.5 — the release and changelog tooling, which
        // is nearly all pure functions and should stay that way.
        "scripts/**/*.ts": { statements: 97, branches: 90, functions: 98, lines: 97 },

        // 80.6 / 87.7 / 84.6 / 80.3. Only the .ts helpers, per the *.tsx note
        // above: date-range-macros.ts and transaction-columns.ts. Issue #142
        // asked for ~70% across all of components/, which needs the renderer
        // Issue #296 adds.
        "components/**/*.ts": { statements: 78, branches: 85, functions: 82, lines: 78 },
      },
    },
  },
});
