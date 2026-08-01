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
  ]),
  // Issue #129. Application code logs through lib/log.ts, which emits one line
  // of JSON per record; a bare console.* is unparseable by anything downstream
  // and carries no route/action/user context. This rule is what keeps that
  // true — it is the standing enforcement of the issue's third acceptance
  // criterion, not a style preference.
  //
  // scripts/ and tests/ are deliberately out of scope: console output *is* the
  // interface of a CLI like check-changelog.ts or create-user.ts.
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.ts", "components/**/*.{ts,tsx}", "hooks/**/*.ts"],
    rules: { "no-console": "error" },
  },
]);

export default eslintConfig;
