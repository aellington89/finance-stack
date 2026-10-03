// CI gate (and `npm run check:audit`): the dependency audit gate, replacing a
// bare `npm audit --audit-level=high` with the same check plus the
// per-advisory allowlist CONTRIBUTING.md names as the deliberate alternative to
// a gate that "goes red and stays red".
//
// Two modes, keeping the split CONTRIBUTING.md keeps and for its reason — which
// one goes red is the diagnosis, not a detail:
//
//   npm run check:audit -- --runtime     the tree that ships inside the image
//   npm run check:audit                  the full tree, dev dependencies included
//
// Stale-entry reporting runs in the full-tree mode only. See findUnusedEntries
// in audit-allowlist-core.ts for why that is correct rather than a shortcut.
//
// The logic lives in scripts/audit-allowlist-core.ts; this is the argv, process
// and stdout shell. Annotation style follows the Seed-reference and Docs-index
// gates: an ::error:: that names the thing and then says what to do about it.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectAdvisories,
  evaluate,
  findUnusedEntries,
  parseAllowlist,
  type Advisory,
  type AllowlistEntry,
  type AllowlistProblem,
} from "@/scripts/audit-allowlist-core";

// This file lives at app/scripts/, so .. is app/.
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = resolve(APP_DIR, ".audit-allowlist");
const ALLOWLIST_LABEL = "app/.audit-allowlist";

const RUNTIME_MODE = process.argv.includes("--runtime");
const GATE = RUNTIME_MODE ? "runtime" : "build-time";
const GATE_LABEL = RUNTIME_MODE
  ? "Dependency audit gate (runtime)"
  : "Dependency audit gate (build-time)";

function runAudit(): unknown {
  const args = ["audit", "--json"];
  if (RUNTIME_MODE) args.push("--omit=dev");

  let stdout: string;
  try {
    stdout = execFileSync("npm", args, {
      cwd: APP_DIR,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // Expected path, not an error path: `npm audit` exits non-zero whenever it
    // finds anything, and finding things is the normal case here. The report is
    // on stdout either way. A genuinely broken run (no registry, bad lockfile)
    // leaves stdout empty or non-JSON, which the parse below rejects.
    const shelled = error as { stdout?: string | Buffer };
    stdout = shelled.stdout?.toString() ?? "";
  }

  if (stdout.trim() === "") {
    console.log(
      `::error::${GATE_LABEL}: \`npm audit --json\` produced no output. ` +
        `The gate cannot be evaluated, so it is failing closed rather than ` +
        `reporting a clean tree. Check registry reachability and that ` +
        `app/package-lock.json is installable with \`npm ci\`.`,
    );
    process.exit(1);
  }

  try {
    return JSON.parse(stdout);
  } catch {
    console.log(
      `::error::${GATE_LABEL}: \`npm audit --json\` output did not parse as ` +
        `JSON. Failing closed rather than reporting a clean tree. Run ` +
        `\`cd app && npm audit --json\` to see what it printed.`,
    );
    process.exit(1);
  }
}

function readAllowlist(): { entries: AllowlistEntry[]; problems: AllowlistProblem[] } {
  // A missing file is a valid empty allowlist — the gate then behaves exactly
  // as the bare `npm audit --audit-level=high` it replaced.
  if (!existsSync(ALLOWLIST_PATH)) return { entries: [], problems: [] };
  return parseAllowlist(readFileSync(ALLOWLIST_PATH, "utf8"));
}

function formatProblem(problem: AllowlistProblem): string {
  switch (problem.reason) {
    case "malformed":
      return (
        `::error::${ALLOWLIST_LABEL}:${problem.line}: cannot read ` +
        `"${problem.text}". Each entry is \`<ADVISORY-ID> exp:YYYY-MM-DD\`, ` +
        `optionally followed by \`runtime\`, with the justification in \`#\` ` +
        `comments beneath it.`
      );
    case "bad-date":
      return (
        `::error::${ALLOWLIST_LABEL}:${problem.line}: ${problem.id} has ` +
        `exp:${problem.expires}, which is not a real date.`
      );
    case "duplicate":
      return (
        `::error::${ALLOWLIST_LABEL}:${problem.line}: ${problem.id} is already ` +
        `listed on line ${problem.firstLine}. Keep one entry per advisory so ` +
        `there is one date and one justification to review.`
      );
  }
}

function describe(advisory: Advisory): string {
  const affects =
    advisory.affects.length > 1
      ? ` (reported against ${advisory.affects.length} packages: ${advisory.affects.join(", ")})`
      : "";
  return (
    `${advisory.id} ${advisory.severity.toUpperCase()} ` +
    `${advisory.packageName} ${advisory.range} — ${advisory.title}${affects}`
  );
}

function main(): void {
  const { entries, problems } = readAllowlist();

  if (problems.length > 0) {
    for (const problem of problems) console.log(formatProblem(problem));
    console.log(
      `::error::${GATE_LABEL}: ${ALLOWLIST_LABEL} has ${problems.length} ` +
        `unreadable ${problems.length === 1 ? "entry" : "entries"}. Failing ` +
        `closed: an entry nobody can parse is an advisory nobody decided about.`,
    );
    process.exit(1);
  }

  const collected = collectAdvisories(runAudit());

  if ("reason" in collected) {
    console.log(
      `::error::${GATE_LABEL}: could not read the audit report — ` +
        `${collected.detail}. Failing closed rather than reporting a clean ` +
        `tree: see collectAdvisories in app/scripts/audit-allowlist-core.ts ` +
        `for why "no advisories found" is never trusted here.`,
    );
    process.exit(1);
  }

  const { advisories } = collected;
  const today = new Date().toISOString().slice(0, 10);
  const result = evaluate({ advisories, allowlist: entries, gate: GATE, today });

  for (const { advisory, entry } of result.suppressed) {
    console.log(
      `  suppressed  ${describe(advisory)} ` +
        `[${ALLOWLIST_LABEL}:${entry.line}, exp:${entry.expires}]`,
    );
  }

  for (const { advisory, entry } of result.expired) {
    console.log(
      `::error::${GATE_LABEL}: ${describe(advisory)} — its allowlist entry ` +
        `(${ALLOWLIST_LABEL}:${entry.line}) expired on ${entry.expires}. ` +
        `Re-check whether a fix has been published; if it has, take it and ` +
        `delete the entry. If it has not, extend the date and say in the ` +
        `comment what changed, so the extension is a decision rather than a ` +
        `renewal.`,
    );
  }

  for (const { advisory, entry } of result.runtimeNotCovered) {
    console.log(
      `::error::${GATE_LABEL}: ${describe(advisory)} — ${ALLOWLIST_LABEL}:` +
        `${entry.line} covers the build-time gate only. This advisory is in ` +
        `the tree that ships inside the image, which is a different decision: ` +
        `add the \`runtime\` marker and say in the comment why shipping it is ` +
        `acceptable, or fix it.`,
    );
  }

  const undecided = result.blocking.filter(
    (advisory) =>
      !result.expired.some((e) => e.advisory.id === advisory.id) &&
      !result.runtimeNotCovered.some((r) => r.advisory.id === advisory.id),
  );

  for (const advisory of undecided) {
    console.log(`::error::${GATE_LABEL}: ${describe(advisory)} — ${advisory.url}`);
  }

  // Stale entries: warnings, never failures. See findUnusedEntries for why this
  // is the full-tree mode's job alone.
  if (!RUNTIME_MODE) {
    for (const entry of findUnusedEntries(entries, advisories)) {
      console.log(
        `::warning::${ALLOWLIST_LABEL}:${entry.line}: ${entry.id} no longer ` +
          `matches any advisory in the tree. From a CI run that means it was ` +
          `fixed upstream — delete the entry and its comment, since nothing ` +
          `removes it automatically.`,
      );
    }
  }

  if (undecided.length > 0) {
    console.log(
      `::error::${GATE_LABEL}: ${undecided.length} ` +
        `${undecided.length === 1 ? "advisory has" : "advisories have"} no ` +
        `allowlist entry. Fix in CONTRIBUTING.md's order of preference — bump ` +
        `it, override it, and only then add a dated, justified entry to ` +
        `${ALLOWLIST_LABEL}.`,
    );
  }

  if (result.blocking.length > 0) process.exit(1);

  const suffix =
    result.suppressed.length > 0
      ? `, ${result.suppressed.length} suppressed by ${ALLOWLIST_LABEL}`
      : "";
  console.log(
    `✓ ${GATE_LABEL}: no unallowlisted HIGH or CRITICAL advisories${suffix}`,
  );
}

main();
