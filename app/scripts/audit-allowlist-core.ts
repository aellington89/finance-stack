// The logic behind the dependency audit gate (`npm run check:audit`), kept in a
// sibling module of the argv/stdout shell so it can be unit-tested — the same
// split check-changelog-core.ts and seed-reference-check.ts use.
//
// WHY THIS EXISTS. `npm audit --audit-level=high` is pass/fail with no
// per-advisory escape hatch, which CONTRIBUTING.md's "Dependency audit gate"
// recorded as fix option 3: "there is no third option yet. If an advisory has no
// fix at all ... the gate goes red and stays red." That state arrived with
// `braces` GHSA-vfj7-8cjw-p6xm, whose affected range is <=3.0.3 while 3.0.3 is
// the newest version published, reaching the tree through two independent paths
// (eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch and
// shadcn -> fast-glob), so no single dependency can be dropped to clear it. A
// red gate on a base branch is inherited by every open Dependabot PR, which is
// precisely the state in which a real regression gets waved through as "the
// usual red".
//
// So this builds the allowlist that section says is the deliberate alternative,
// and deliberately mirrors .trivyignore's contract rather than inventing a
// second one: an entry is an advisory id, an expiry date, and a comment saying
// why. The two differ in one way that matters, below.
//
// GRANULARITY IS THE ADVISORY, NOT THE PACKAGE. npm reports a package as
// vulnerable both when an advisory names it and when it merely depends on
// something vulnerable; only the first carries an advisory object in `via`. The
// braces advisory is reported against eight packages and is one decision, so
// one entry clears all eight and a new advisory against any of them still goes
// red. Allowlisting by package name would have silenced those seven collaterally.
//
// RUNTIME IS NOT COVERED BY DEFAULT, which is where this parts company with
// .trivyignore. That file backs four scans from one list and its header warns
// that an entry therefore widens to images that never reported the finding.
// Here the same widening would cross the line CONTRIBUTING.md draws between the
// two gates — "runtime red means the advisory ships to users; build-time red
// means it is confined to the toolchain" — so a bare entry covers the
// build-time gate only, and reaching the runtime gate takes an explicit
// `runtime` marker. Every advisory this file was written for is dev-tree, so the
// common entry stays the .trivyignore shape and the dangerous one has to be
// spelled out.

/** Severities the gate blocks on, mirroring `npm audit --audit-level=high`. */
export const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

export interface AllowlistEntry {
  /** `GHSA-...`, or npm's numeric advisory id as a string. */
  id: string;
  /** `YYYY-MM-DD`, as written. */
  expires: string;
  /** True when the entry carries the `runtime` marker. */
  coversRuntime: boolean;
  /** 1-indexed line in the allowlist, for annotations. */
  line: number;
}

export type AllowlistProblem =
  | { reason: "malformed"; line: number; text: string }
  | { reason: "bad-date"; line: number; id: string; expires: string }
  | { reason: "duplicate"; line: number; id: string; firstLine: number };

export interface ParsedAllowlist {
  entries: AllowlistEntry[];
  problems: AllowlistProblem[];
}

export interface Advisory {
  /** `GHSA-...` when npm gives a parseable advisory url, else the numeric id. */
  id: string;
  /** npm's numeric advisory id, kept so either form matches an entry. */
  source: string;
  title: string;
  url: string;
  severity: string;
  /** The affected version range, e.g. `<=3.0.3`. */
  range: string;
  /** The package the advisory is filed against. */
  packageName: string;
  /** Every package npm reported as vulnerable because of this advisory. */
  affects: string[];
}

export type AuditShapeError = { reason: "unrecognized-report"; detail: string };

// `exp:` is honoured the way Trivy honours it, with the boundary pinned down
// because Trivy's own docs leave it ambiguous: the suppression holds up to and
// including the day before the date, and the advisory is back on the date
// itself. An entry written `exp:2026-11-07` therefore stops working on
// 2026-11-07, not on the 8th.
// Positional groups rather than named ones: tsconfig.json targets below ES2018,
// where `(?<name>...)` is a compile error.
//   [1] advisory id   [2] expiry date   [3] optional trailing marker
const ENTRY_PATTERN =
  /^([A-Za-z0-9][A-Za-z0-9-]*)\s+exp:(\d{4}-\d{2}-\d{2})(\s+\S.*)?$/;

function isRealDate(value: string): boolean {
  // `new Date("2026-02-31")` does not throw, it rolls over to March, so compare
  // the round-trip rather than trusting the parse.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/**
 * Parses an allowlist file. Comments (`#`) and blank lines are skipped, exactly
 * as Trivy reads .trivyignore, so the two files look the same to a reader.
 */
export function parseAllowlist(text: string): ParsedAllowlist {
  const entries: AllowlistEntry[] = [];
  const problems: AllowlistProblem[] = [];
  const seen = new Map<string, number>();

  text.split("\n").forEach((rawLine, index) => {
    const line = index + 1;
    const trimmed = rawLine.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;

    const match = ENTRY_PATTERN.exec(trimmed);
    if (!match) {
      problems.push({ reason: "malformed", line, text: trimmed });
      return;
    }

    const [, id, expires, rest] = match;

    // Anything after the date must be the `runtime` marker and nothing else. A
    // typo here would otherwise read as a bare entry and silently fail to cover
    // the runtime gate the author was reaching for.
    const marker = rest?.trim();
    if (marker !== undefined && marker !== "runtime") {
      problems.push({ reason: "malformed", line, text: trimmed });
      return;
    }

    if (!isRealDate(expires)) {
      problems.push({ reason: "bad-date", line, id, expires });
      return;
    }

    const firstLine = seen.get(id);
    if (firstLine !== undefined) {
      problems.push({ reason: "duplicate", line, id, firstLine });
      return;
    }
    seen.set(id, line);

    entries.push({ id, expires, coversRuntime: marker === "runtime", line });
  });

  return { entries, problems };
}

function ghsaFromUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  return /\/(GHSA-[0-9a-z-]+)\s*$/i.exec(url.trim())?.[1];
}

/**
 * Pulls the advisories out of `npm audit --json`.
 *
 * FAILS SAFE, which is the whole reason this returns a union. Advisories live in
 * `vulnerabilities[pkg].via` as objects, beside plain strings naming another
 * vulnerable package. If npm renames or restructures that, the naive reading is
 * "no advisories found" — i.e. the gate goes green on an audit it could not
 * read, which is the inverse of what a gate is for. Mirrors the same guard
 * scripts/check-trivy-suppressions.sh carries for `ExperimentalModifiedFindings`.
 */
export function collectAdvisories(
  report: unknown,
): { advisories: Advisory[] } | AuditShapeError {
  if (typeof report !== "object" || report === null) {
    return { reason: "unrecognized-report", detail: "report is not an object" };
  }

  const record = report as Record<string, unknown>;
  const vulnerabilities = record.vulnerabilities;

  if (typeof vulnerabilities !== "object" || vulnerabilities === null) {
    return {
      reason: "unrecognized-report",
      detail: "no `vulnerabilities` object — npm audit --json schema changed",
    };
  }

  const byId = new Map<string, Advisory>();
  let sawViaArray = false;

  for (const [affectedPackage, raw] of Object.entries(
    vulnerabilities as Record<string, unknown>,
  )) {
    if (typeof raw !== "object" || raw === null) continue;
    const via = (raw as Record<string, unknown>).via;
    if (!Array.isArray(via)) continue;
    sawViaArray = true;

    for (const item of via) {
      // A string names another vulnerable package: collateral damage, not an
      // advisory of its own, and never something to allowlist.
      if (typeof item !== "object" || item === null) continue;

      const entry = item as Record<string, unknown>;
      const source = entry.source;
      const id = ghsaFromUrl(entry.url) ?? (source != null ? String(source) : undefined);
      if (id === undefined) continue;

      const existing = byId.get(id);
      if (existing) {
        if (!existing.affects.includes(affectedPackage)) {
          existing.affects.push(affectedPackage);
        }
        continue;
      }

      byId.set(id, {
        id,
        source: source != null ? String(source) : "",
        title: typeof entry.title === "string" ? entry.title : "(no title)",
        url: typeof entry.url === "string" ? entry.url : "",
        severity: typeof entry.severity === "string" ? entry.severity : "unknown",
        range: typeof entry.range === "string" ? entry.range : "",
        packageName: typeof entry.name === "string" ? entry.name : affectedPackage,
        affects: [affectedPackage],
      });
    }
  }

  // A report that lists vulnerable packages but yielded no `via` array at all is
  // the schema change above, not a clean tree.
  if (!sawViaArray && Object.keys(vulnerabilities as object).length > 0) {
    return {
      reason: "unrecognized-report",
      detail: "vulnerabilities carried no `via` arrays — npm audit --json schema changed",
    };
  }

  return { advisories: [...byId.values()] };
}

export interface SuppressedAdvisory {
  advisory: Advisory;
  entry: AllowlistEntry;
}

export interface ExpiredSuppression {
  advisory: Advisory;
  entry: AllowlistEntry;
}

export interface RuntimeNotCovered {
  advisory: Advisory;
  entry: AllowlistEntry;
}

export interface GateResult {
  /** Blocks the gate: no entry, an expired entry, or a build-time-only entry. */
  blocking: Advisory[];
  suppressed: SuppressedAdvisory[];
  /** Listed, matched, but past `exp:` — reported distinctly from "not listed". */
  expired: ExpiredSuppression[];
  /** Runtime-gate advisories whose entry lacks the `runtime` marker. */
  runtimeNotCovered: RuntimeNotCovered[];
}

export interface EvaluateOptions {
  advisories: Advisory[];
  allowlist: AllowlistEntry[];
  /** The runtime gate (`--omit=dev`) requires the `runtime` marker. */
  gate: "runtime" | "build-time";
  /** `YYYY-MM-DD`, injected so the expiry boundary is testable. */
  today: string;
}

/** Decides each blocking-severity advisory against the allowlist. */
export function evaluate({
  advisories,
  allowlist,
  gate,
  today,
}: EvaluateOptions): GateResult {
  const byId = new Map<string, AllowlistEntry>();
  for (const entry of allowlist) {
    byId.set(entry.id, entry);
  }

  const result: GateResult = {
    blocking: [],
    suppressed: [],
    expired: [],
    runtimeNotCovered: [],
  };

  for (const advisory of advisories) {
    if (!BLOCKING_SEVERITIES.has(advisory.severity)) continue;

    // Either form npm might print matches, so an entry written from the url and
    // one written from the numeric id behave the same.
    const entry = byId.get(advisory.id) ?? byId.get(advisory.source);

    if (!entry) {
      result.blocking.push(advisory);
      continue;
    }

    if (entry.expires <= today) {
      result.expired.push({ advisory, entry });
      result.blocking.push(advisory);
      continue;
    }

    if (gate === "runtime" && !entry.coversRuntime) {
      result.runtimeNotCovered.push({ advisory, entry });
      result.blocking.push(advisory);
      continue;
    }

    result.suppressed.push({ advisory, entry });
  }

  return result;
}

/**
 * Entries that matched nothing in the tree they were checked against.
 *
 * Only meaningful against the build-time gate, and that is not a limitation
 * worth working around: the full tree is a strict superset of the runtime tree
 * (CONTRIBUTING.md: "the second subsumes the first"), so an entry unused there
 * is unused everywhere, while an entry checked only against the runtime tree
 * would look stale whenever it is doing its job in the dev tree. Reported as a
 * warning and never a failure — a stale entry is not a vulnerability, and a gate
 * that goes red for tidiness is a gate people stop reading.
 */
export function findUnusedEntries(
  allowlist: AllowlistEntry[],
  advisories: Advisory[],
): AllowlistEntry[] {
  const matched = new Set<string>();
  for (const advisory of advisories) {
    matched.add(advisory.id);
    if (advisory.source) matched.add(advisory.source);
  }
  return allowlist.filter((entry) => !matched.has(entry.id));
}
