import { defineConfig, coverageConfigDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Three projects, split by what each one needs rather than by what it
    // covers: no DOM, a DOM, a database. Note there is no per-project
    // `plugins` repeat — under vitest 5 an inline project extends the config
    // that declares it, so the root tsconfigPaths() above already applies and
    // repeating it warns.
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          // Issue #296. The renderer the other two projects do not have, and
          // the reason `**/*.tsx` is no longer in coverage.exclude below.
          // Collected by extension rather than by directory: `*.test.tsx` here
          // and `*.test.ts` above are disjoint by construction, so no file is
          // ever picked up by two projects.
          name: "jsdom",
          include: ["tests/unit/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["tests/jsdom/vitest-setup.ts"],
        },
      },
      {
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
    // three numbered notes below for how. Traps 1 and 3 are still live mistakes
    // waiting to be made; trap 2 is a behaviour vitest 5 removed, kept because
    // the old rule is the one a reader will have in mind.
    //
    // Read `include` as "the surface the suite can actually reach". Everything
    // it cannot execute is excluded and says why. That is a deliberately
    // smaller denominator than "all source": padding it with files no test can
    // run makes the percentage a constant rather than a gate, and a constant
    // cannot detect a regression.
    //
    // Issue #296 widened that surface rather than the rule. The jsdom project
    // can mount React, so components/**/*.tsx and hooks/** came in and the
    // blanket `**/*.tsx` exclusion went out. The denominator went 1649 -> 2677
    // statements, and the global numbers held: 88.3 -> 86.1 across a set that
    // is 62% larger and now includes the React tree. That is the whole point of
    // the issue — the old number was high partly because it was not asking the
    // components anything.
    coverage: {
      provider: "v8",

      // Trap 1: these globs resolve against the vite root (this directory),
      // NOT the repo root. `app/api/health/**` below is app/app/api/health/ on
      // disk. Getting this backwards silently matches nothing, which reads as
      // "that code is uncovered" rather than as a broken pattern.
      //
      // Trap 2, and here the correction matters more than the trap did. Under
      // vitest 4 `include` was applied with picomatch's `contains: true`,
      // matching a pattern against any SUBSTRING of the absolute path — so
      // `components/**/*.ts` also matched card.tsx, because
      // "components/ui/card.ts" is a substring of
      // ".../components/ui/card.tsx", and a blanket `**/*.tsx` entry in
      // `exclude` was the only thing holding the React tree out of the report.
      //
      // vitest 5 dropped that: these globs are anchored and mean exactly what
      // they say. Verified rather than assumed — removing that blanket
      // exclusion on its own moved the denominator by 11 statements, and the 41
      // component files appeared only once `components/**/*.tsx` was listed
      // here explicitly. If a .tsx file looks uncovered but is absent from the
      // report altogether, this is why. It is also why nothing below needs to
      // guard against `tests/` or `.next/standalone/` — neither can match an
      // anchored glob rooted at lib/, components/, scripts/ or hooks/.
      include: [
        "lib/**/*.ts",
        // The two routes with real logic, both covered by
        // tests/integration/api/. Deliberately not `app/api/**`, which would
        // also take app/api/auth/[...nextauth]/route.ts — three lines
        // re-exporting `handlers` from auth.ts, which is itself excluded below.
        "app/api/health/**/*.ts",
        "components/**/*.ts",
        // Issue #296. The React tree, in only because the jsdom project can
        // now mount it. This has to be spelled out rather than inferred from
        // the `*.ts` line above — see Trap 2.
        "components/**/*.tsx",
        "scripts/**/*.ts",
        // Issue #296. In only because there is now a renderer: useIsMobile is
        // state plus a matchMedia listener, so every line of it needs mounting
        // to reach. Tested through renderHook in tests/unit/hooks/.
        "hooks/**/*.ts",
        "instrumentation.ts",
      ],

      exclude: [
        // Kept as a spread on principle, but note it is empty as of vitest 5:
        // coverageConfigDefaults.exclude was a long list in vitest 4 (it is
        // what used to hold **/node_modules/** and **/[.]** out) and is now
        // `[]`. Nothing here relies on it any more — what keeps node_modules,
        // .next/standalone (which contains a full copy of components/) and the
        // rest out is that every `include` glob above is anchored, so a path
        // has to *start* with lib/, components/, scripts/ or hooks/ to match.
        // Left in place so a future vitest that repopulates it is inherited
        // rather than silently dropped.
        ...coverageConfigDefaults.exclude,

        // Generated, not authored. `npx shadcn add <name>` rewrites these
        // wholesale — chart.tsx even carries a "DIVERGES FROM UPSTREAM" notice
        // for the one place we edited it — so gating them would turn a routine
        // re-generation into a CI failure with no bug behind it. The primitives
        // still execute (they render inside the components that are gated);
        // they are simply not held to a number.
        //
        // The one thing this would have dropped is chartColorVars, whose key
        // filter is the security half of #237. It now lives in the sibling
        // chart-colors.ts and stays in the denominator.
        "components/ui/**/*.tsx",

        // The eleven recharts wrappers, excluded because a test of one cannot
        // assert anything. They all render through ChartContainer ->
        // ResponsiveContainer, which has no layout under jsdom: a mounted
        // chart produces {svg: 0, rect: 0, text: 0} — the container element and
        // nothing inside it. Measured, not assumed. So a render test buys 41%
        // of the file's statements, 2 of its 8 functions and 0% of its
        // branches while asserting only the card title, which is the definition
        // of coverage theatre. Every tick and tooltip formatter stays
        // unexecuted because no axis is ever drawn.
        //
        // What makes this honest rather than convenient is that Issue #296
        // emptied these files first. The transforms are in *-bars.ts and
        // timeseries-pivot.ts, the axis formatters in accounting-axis.ts, and
        // the currency/date helpers in lib/format/ — all tested, all still in
        // the denominator. What is excluded is declarative recharts markup.
        //
        // The `-chart.tsx` suffix is load-bearing: it is what keeps
        // gauge-badge.tsx, the one hand-rolled SVG in this directory, IN the
        // denominator, where it renders fully under jsdom and is tested. A new
        // file here that does not mount recharts must not be named `*-chart`.
        "components/charts/*-chart.tsx",

        // Both of these are belt-and-braces, and it is worth saying so rather
        // than implying they are doing work. `tests/` is not in `include` at
        // all, and anchored globs cannot reach it, so neither line changes the
        // report today — checked by removing them and re-measuring (2992
        // statements either way, zero test files in the map). Under vitest 4's
        // substring matching `components/**/*.ts` *did* also match
        // tests/unit/components/x.test.tsx, so keep them: they cost nothing
        // and they are the guard if that behaviour ever returns.
        "**/*.test.tsx",
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

      // Trap 3: threshold globs are matched against the path relative to this
      // directory and are anchored — `lib/**/*.ts` here really does mean .ts
      // only, and `components/**/*.ts` does NOT also catch the .tsx files.
      // That was the one thing vitest 4's `include` did differently and vitest
      // 5 has now made uniform, so the two halves of this block finally agree.
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
      // Baseline measured 2026-09-23 over the merged unit+jsdom+integration
      // run (1066 tests, 93 files, 2677 statements):
      // 86.10 / 75.13 / 79.88 / 86.80. Branches is the weak metric across
      // every glob and the one to watch.
      thresholds: {
        statements: 84,
        branches: 73,
        functions: 77,
        lines: 84,

        // 86.2 / 74.8 / 83.4 / 86.9. Most of this is earned by the integration
        // project, not the unit one: lib/queries and lib/actions are ~840
        // statements that sit near 5% on a `--project unit` run. Left at the
        // #142 numbers rather than re-baselined — nothing in #296 touched
        // lib/'s behaviour, so raising them belongs in its own diff.
        "lib/**/*.ts": { statements: 83, branches: 71, functions: 80, lines: 84 },

        // 100 / 96.6 / 100 / 100 — the release and changelog tooling, which
        // is nearly all pure functions and should stay that way. Also left at
        // the #142 numbers, for the same reason as lib/ above.
        "scripts/**/*.ts": { statements: 97, branches: 90, functions: 98, lines: 97 },

        // 99.6 / 96.9 / 100 / 99.5, up from 80.6 / 87.7 / 84.6 / 80.3 — and
        // re-baselined because #296 is what changed it. This glob used to cover
        // two incidental helpers; it now covers nine modules, and every one of
        // them is logic lifted out of a .tsx component: the tile and bar
        // builders, the timeseries pivots, the accounting axis formatters and
        // chart-colors. Pure functions with no renderer between them and the
        // test — this is the number that should stay near 100.
        "components/**/*.ts": { statements: 97, branches: 94, functions: 98, lines: 97 },

        // 77.0 / 65.3 / 69.0 / 78.6 over 30 files, up from an unmeasured
        // denominator before #296 and from 28.8% at the point the .tsx files
        // first entered it. This is #142's deferred "~70% for components"
        // criterion, met. The 30 files are the component tree minus the
        // vendored shadcn primitives and the eleven recharts wrappers, both
        // excluded above with their reasons; every remaining file but
        // app-sidebar.tsx has a render test.
        "components/**/*.tsx": { statements: 74, branches: 63, functions: 66, lines: 76 },

        // 100 across the board over one 19-line file. Issue #296 brought
        // hooks/ into `include` for the first time — the old `hooks/**`
        // exclusion was belt-and-braces, since no include glob reached it.
        "hooks/**/*.ts": { statements: 98, branches: 98, functions: 98, lines: 98 },
      },
    },
  },
});
