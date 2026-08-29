import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test output
    "coverage/**",
    // Playwright's report and its traces/screenshots (Issue #141).
    "playwright-report/**",
    "test-results/**",
  ]),
  // Issue #129. Application code logs through lib/log.ts, which emits one line
  // of JSON per record; a bare console.* is unparseable by anything downstream
  // and carries no route/action/user context. This rule is what keeps that
  // true — it is the standing enforcement of the issue's third acceptance
  // criterion, not a style preference.
  //
  // scripts/, tests/ and e2e/ are deliberately out of scope: console output
  // *is* the interface of a CLI like check-changelog.ts or create-user.ts, and
  // of a Playwright global setup. Note this is scoping by inclusion — the four
  // globs below name the application tree, so a new directory outside it is
  // exempt by construction rather than by an ignore entry.
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.ts", "components/**/*.{ts,tsx}", "hooks/**/*.ts"],
    rules: { "no-console": "error" },
  },
  // Issue #179. sql.raw() splices its argument into the SQL text with no
  // escaping, so it is the one drizzle API that can carry a value into a query
  // as syntax rather than as a parameter. The audit found exactly that: a URL
  // search param reaching sql.raw() in lib/queries/accounting.ts, held back
  // only by a regex.
  //
  // Every previous use has an escaped or bound equivalent — bind the value,
  // sql.identifier() for an identifier, valueList() for an IN (…) list, or a
  // static sql`` fragment — so the rule is absolute rather than a default with
  // opt-outs. Reaching for an eslint-disable here means the fragment being
  // built is the wrong shape; see docs/input-validation.md.
  //
  // tests/, scripts/ and e2e/ are out of scope, as with no-console above.
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.ts", "components/**/*.{ts,tsx}", "hooks/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "sql",
          property: "raw",
          message:
            "sql.raw() bypasses parameterization (Issue #179). Bind the value with ${…}, use sql.identifier() for an identifier, valueList() for an IN (…) list, or build a static sql`` fragment.",
        },
      ],
    },
  },
]);

export default eslintConfig;
