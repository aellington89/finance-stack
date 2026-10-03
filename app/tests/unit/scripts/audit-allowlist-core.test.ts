import { describe, expect, it } from "vitest";

import {
  collectAdvisories,
  evaluate,
  findUnusedEntries,
  parseAllowlist,
  type Advisory,
  type AllowlistEntry,
} from "@/scripts/audit-allowlist-core";

// A representative allowlist: the header comment style the real file uses, a
// bare entry, and one carrying the `runtime` marker.
const ALLOWLIST = `\
# Per-advisory suppressions for the dependency audit gate.
#
# Format:
#   GHSA-xxxx-xxxx-xxxx exp:YYYY-MM-DD

GHSA-vfj7-8cjw-p6xm exp:2026-11-14
# braces, dev tree only.

GHSA-aaaa-bbbb-cccc exp:2026-12-01 runtime
# ships inside the image, decided deliberately.
`;

// The shape `npm audit --json` returns: advisories are objects in `via`, and a
// plain string in `via` names another vulnerable package rather than an
// advisory of its own. braces is reported against three packages here from one
// advisory, which is the case the gate has to collapse to a single decision.
const AUDIT_REPORT = {
  auditReportVersion: 2,
  vulnerabilities: {
    braces: {
      name: "braces",
      severity: "high",
      via: [
        {
          source: 1240992,
          name: "braces",
          title: "braces vulnerable to stack-exhaustion denial of service",
          url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
          severity: "high",
          range: "<=3.0.3",
        },
      ],
    },
    micromatch: { name: "micromatch", severity: "high", via: ["braces"] },
    "fast-glob": {
      name: "fast-glob",
      severity: "high",
      via: [
        "micromatch",
        {
          source: 1240992,
          name: "braces",
          title: "braces vulnerable to stack-exhaustion denial of service",
          url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
          severity: "high",
          range: "<=3.0.3",
        },
      ],
    },
    "fast-uri": {
      name: "fast-uri",
      severity: "moderate",
      via: [
        {
          source: 1240777,
          name: "fast-uri",
          title: "fast-uri inconsistent host case normalization",
          url: "https://github.com/advisories/GHSA-hrr3-gc8f-f4qj",
          severity: "moderate",
          range: "3.0.0 - 3.1.7",
        },
      ],
    },
  },
};

function advisory(overrides: Partial<Advisory> = {}): Advisory {
  return {
    id: "GHSA-vfj7-8cjw-p6xm",
    source: "1240992",
    title: "braces stack exhaustion",
    url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    severity: "high",
    range: "<=3.0.3",
    packageName: "braces",
    affects: ["braces"],
    ...overrides,
  };
}

function entry(overrides: Partial<AllowlistEntry> = {}): AllowlistEntry {
  return {
    id: "GHSA-vfj7-8cjw-p6xm",
    expires: "2026-11-14",
    coversRuntime: false,
    line: 6,
    ...overrides,
  };
}

describe("parseAllowlist", () => {
  it("reads entries and skips comments and blank lines", () => {
    const { entries, problems } = parseAllowlist(ALLOWLIST);

    expect(problems).toEqual([]);
    expect(entries).toEqual([
      {
        id: "GHSA-vfj7-8cjw-p6xm",
        expires: "2026-11-14",
        coversRuntime: false,
        line: 6,
      },
      {
        id: "GHSA-aaaa-bbbb-cccc",
        expires: "2026-12-01",
        coversRuntime: true,
        line: 9,
      },
    ]);
  });

  it("treats a missing or empty file as an empty allowlist", () => {
    expect(parseAllowlist("")).toEqual({ entries: [], problems: [] });
    expect(parseAllowlist("# nothing but a comment\n")).toEqual({
      entries: [],
      problems: [],
    });
  });

  it("accepts npm's numeric advisory id as well as a GHSA", () => {
    const { entries, problems } = parseAllowlist("1240992 exp:2026-11-14\n");

    expect(problems).toEqual([]);
    expect(entries[0]?.id).toBe("1240992");
  });

  it("reports an entry with no expiry date", () => {
    const { entries, problems } = parseAllowlist("GHSA-vfj7-8cjw-p6xm\n");

    expect(entries).toEqual([]);
    expect(problems).toEqual([
      { reason: "malformed", line: 1, text: "GHSA-vfj7-8cjw-p6xm" },
    ]);
  });

  // A typo'd marker must not read as a bare entry: that would silently fail to
  // cover the runtime gate the author was reaching for.
  it("reports an unrecognised marker rather than ignoring it", () => {
    const { entries, problems } = parseAllowlist(
      "GHSA-vfj7-8cjw-p6xm exp:2026-11-14 runtimee\n",
    );

    expect(entries).toEqual([]);
    expect(problems[0]?.reason).toBe("malformed");
  });

  it("reports a date that is not a real calendar date", () => {
    const { entries, problems } = parseAllowlist(
      "GHSA-vfj7-8cjw-p6xm exp:2026-02-31\n",
    );

    expect(entries).toEqual([]);
    expect(problems).toEqual([
      {
        reason: "bad-date",
        line: 1,
        id: "GHSA-vfj7-8cjw-p6xm",
        expires: "2026-02-31",
      },
    ]);
  });

  it("reports a duplicate id and keeps the first entry", () => {
    const { entries, problems } = parseAllowlist(
      "GHSA-vfj7-8cjw-p6xm exp:2026-11-14\nGHSA-vfj7-8cjw-p6xm exp:2027-01-01\n",
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.expires).toBe("2026-11-14");
    expect(problems).toEqual([
      {
        reason: "duplicate",
        line: 2,
        id: "GHSA-vfj7-8cjw-p6xm",
        firstLine: 1,
      },
    ]);
  });
});

describe("collectAdvisories", () => {
  it("collapses one advisory reported against several packages", () => {
    const result = collectAdvisories(AUDIT_REPORT);

    expect("advisories" in result).toBe(true);
    if (!("advisories" in result)) return;

    const braces = result.advisories.find((a) => a.id === "GHSA-vfj7-8cjw-p6xm");
    expect(braces).toBeDefined();
    expect(braces?.affects).toEqual(["braces", "fast-glob"]);
    expect(braces?.severity).toBe("high");
    expect(braces?.source).toBe("1240992");
  });

  it("ignores the plain-string `via` entries that name collateral packages", () => {
    const result = collectAdvisories(AUDIT_REPORT);
    if (!("advisories" in result)) throw new Error("expected advisories");

    // micromatch is high-severity but carries no advisory of its own, so it is
    // never a thing to allowlist.
    expect(result.advisories.map((a) => a.id)).toEqual([
      "GHSA-vfj7-8cjw-p6xm",
      "GHSA-hrr3-gc8f-f4qj",
    ]);
  });

  it("falls back to the numeric id when there is no parseable advisory url", () => {
    const result = collectAdvisories({
      vulnerabilities: {
        mystery: {
          severity: "critical",
          via: [{ source: 999, title: "no url", severity: "critical" }],
        },
      },
    });
    if (!("advisories" in result)) throw new Error("expected advisories");

    expect(result.advisories[0]?.id).toBe("999");
    expect(result.advisories[0]?.packageName).toBe("mystery");
  });

  it("reports a clean tree as no advisories", () => {
    const result = collectAdvisories({ auditReportVersion: 2, vulnerabilities: {} });

    expect(result).toEqual({ advisories: [] });
  });

  // The fail-safe. "No advisories found" from an unreadable report is the one
  // output that would take the gate green on an audit it could not read.
  it.each([
    ["a non-object report", null],
    ["a report with no vulnerabilities key", { auditReportVersion: 2 }],
    [
      "vulnerabilities carrying no via arrays",
      { vulnerabilities: { braces: { severity: "high", advisories: [] } } },
    ],
  ])("refuses to read %s", (_label, report) => {
    const result = collectAdvisories(report);

    expect("reason" in result).toBe(true);
    if (!("reason" in result)) return;
    expect(result.reason).toBe("unrecognized-report");
  });
});

describe("evaluate", () => {
  it("blocks an advisory with no entry", () => {
    const result = evaluate({
      advisories: [advisory()],
      allowlist: [],
      gate: "build-time",
      today: "2026-10-03",
    });

    expect(result.blocking).toHaveLength(1);
    expect(result.suppressed).toEqual([]);
  });

  it("suppresses an advisory with a live entry", () => {
    const result = evaluate({
      advisories: [advisory()],
      allowlist: [entry()],
      gate: "build-time",
      today: "2026-10-03",
    });

    expect(result.blocking).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
  });

  it("ignores advisories below the blocking severities", () => {
    const result = evaluate({
      advisories: [advisory({ severity: "moderate" })],
      allowlist: [],
      gate: "build-time",
      today: "2026-10-03",
    });

    expect(result.blocking).toEqual([]);
    expect(result.suppressed).toEqual([]);
  });

  it("matches an entry written with the numeric id", () => {
    const result = evaluate({
      advisories: [advisory()],
      allowlist: [entry({ id: "1240992" })],
      gate: "build-time",
      today: "2026-10-03",
    });

    expect(result.suppressed).toHaveLength(1);
  });

  // `exp:` is honoured the way the file documents it: the suppression stops
  // working ON the date, not the day after.
  it("stops suppressing on the expiry date itself", () => {
    const live = evaluate({
      advisories: [advisory()],
      allowlist: [entry({ expires: "2026-11-14" })],
      gate: "build-time",
      today: "2026-11-13",
    });
    expect(live.suppressed).toHaveLength(1);
    expect(live.expired).toEqual([]);

    const expired = evaluate({
      advisories: [advisory()],
      allowlist: [entry({ expires: "2026-11-14" })],
      gate: "build-time",
      today: "2026-11-14",
    });
    expect(expired.suppressed).toEqual([]);
    expect(expired.expired).toHaveLength(1);
    expect(expired.blocking).toHaveLength(1);
  });

  it("does not let a bare entry cover the runtime gate", () => {
    const result = evaluate({
      advisories: [advisory()],
      allowlist: [entry({ coversRuntime: false })],
      gate: "runtime",
      today: "2026-10-03",
    });

    expect(result.suppressed).toEqual([]);
    expect(result.runtimeNotCovered).toHaveLength(1);
    expect(result.blocking).toHaveLength(1);
  });

  it("covers the runtime gate when the entry is marked for it", () => {
    const result = evaluate({
      advisories: [advisory()],
      allowlist: [entry({ coversRuntime: true })],
      gate: "runtime",
      today: "2026-10-03",
    });

    expect(result.runtimeNotCovered).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.blocking).toEqual([]);
  });

  // An expired entry is reported differently from a missing one: "you decided
  // this once and the decision lapsed" needs a different fix than "nobody
  // looked at this".
  it("reports an expired entry distinctly from a missing one", () => {
    const result = evaluate({
      advisories: [advisory(), advisory({ id: "GHSA-zzzz-zzzz-zzzz", source: "7" })],
      allowlist: [entry({ expires: "2026-01-01" })],
      gate: "build-time",
      today: "2026-10-03",
    });

    expect(result.blocking).toHaveLength(2);
    expect(result.expired.map((e) => e.advisory.id)).toEqual([
      "GHSA-vfj7-8cjw-p6xm",
    ]);
  });
});

describe("findUnusedEntries", () => {
  it("names entries that matched no advisory", () => {
    const unused = findUnusedEntries(
      [entry(), entry({ id: "GHSA-dead-dead-dead", line: 20 })],
      [advisory()],
    );

    expect(unused.map((e) => e.id)).toEqual(["GHSA-dead-dead-dead"]);
  });

  it("counts an entry written with the numeric id as used", () => {
    const unused = findUnusedEntries([entry({ id: "1240992" })], [advisory()]);

    expect(unused).toEqual([]);
  });
});
