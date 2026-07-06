import { describe, expect, it } from "vitest";
import {
  formatChangelog,
  formatRelease,
  groupCommits,
  parseCommits,
  suggestBump,
} from "@/scripts/release-notes-core";

// Representative git log --oneline output matching the repo's commit patterns.
const GIT_LOG = `\
b3b6593 Issue #134 - Extract amountColorClass + shared SQL aggregations
868d4e4 Issue #134 - Extract amountColorClass + shared SQL aggregations
19ee5db Issue #150 - Centralize date-range validation
385ed7a Clean up .gitignore files (#154)
1df841c Replace pull-based drift gate with generate-based check`;

describe("parseCommits", () => {
  it("parses Issue #N commits", () => {
    const commits = parseCommits("b3b6593 Issue #134 - Extract amountColorClass + shared SQL aggregations");
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ issueNumber: 134, subject: "Extract amountColorClass + shared SQL aggregations", prRef: null });
  });

  it("parses (#N) PR-ref commits", () => {
    const commits = parseCommits("385ed7a Clean up .gitignore files (#154)");
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ issueNumber: null, prRef: 154, hash: "385ed7a" });
  });

  it("parses freeform commits", () => {
    const commits = parseCommits("1df841c Replace pull-based drift gate with generate-based check");
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ issueNumber: null, prRef: null, hash: "1df841c", subject: "Replace pull-based drift gate with generate-based check" });
  });

  it("parses all lines from multi-line input", () => {
    const commits = parseCommits(GIT_LOG);
    expect(commits).toHaveLength(5);
  });

  it("returns empty array for empty input", () => {
    expect(parseCommits("")).toEqual([]);
    expect(parseCommits("   \n  \n  ")).toEqual([]);
  });
});

describe("groupCommits", () => {
  it("deduplicates two Issue #134 commits to a single entry", () => {
    const commits = parseCommits(GIT_LOG);
    const { issues } = groupCommits(commits);
    const issue134 = issues.filter((e) => e.issueNumber === 134);
    expect(issue134).toHaveLength(1);
  });

  it("preserves the first-seen subject when deduplicating", () => {
    const commits = parseCommits(GIT_LOG);
    const { issues } = groupCommits(commits);
    expect(issues.find((e) => e.issueNumber === 134)?.subject).toBe(
      "Extract amountColorClass + shared SQL aggregations",
    );
  });

  it("buckets (#154) PR-ref commit into Other", () => {
    const commits = parseCommits(GIT_LOG);
    const { other } = groupCommits(commits);
    expect(other.some((s) => s.includes("385ed7a"))).toBe(true);
  });

  it("buckets freeform commits into Other with short hash", () => {
    const commits = parseCommits(GIT_LOG);
    const { other } = groupCommits(commits);
    expect(other.some((s) => s.includes("1df841c"))).toBe(true);
  });

  it("returns empty lists for an empty commit range", () => {
    const { issues, other } = groupCommits([]);
    expect(issues).toEqual([]);
    expect(other).toEqual([]);
  });

  it("collects all unique issue entries in order", () => {
    const commits = parseCommits(GIT_LOG);
    const { issues } = groupCommits(commits);
    expect(issues.map((e) => e.issueNumber)).toEqual([134, 150]);
  });
});

describe("suggestBump", () => {
  it("returns minor bump when any issue has an enhancement label", () => {
    const labels = new Map([[134, ["enhancement", "frontend"]], [150, ["bug"]]]);
    const { bump } = suggestBump("0.1.3", labels);
    expect(bump).toBe("minor");
  });

  it("returns patch bump when no enhancement labels are present", () => {
    const labels = new Map([[134, ["tech-debt"]], [150, ["bug"]]]);
    const { bump } = suggestBump("0.1.3", labels);
    expect(bump).toBe("patch");
  });

  it("returns patch bump for empty label map (no issues in range)", () => {
    const { bump } = suggestBump("0.1.3", new Map());
    expect(bump).toBe("patch");
  });

  it("computes correct next version for patch bump on 0.1.3", () => {
    const { nextVersion } = suggestBump("0.1.3", new Map([[1, ["bug"]]]));
    expect(nextVersion).toBe("0.1.4");
  });

  it("computes correct next version for minor bump on 0.1.3", () => {
    const { nextVersion } = suggestBump("0.1.3", new Map([[1, ["enhancement"]]]));
    expect(nextVersion).toBe("0.2.0");
  });

  it("zeros patch on minor bump", () => {
    const { nextVersion } = suggestBump("0.1.9", new Map([[1, ["enhancement"]]]));
    expect(nextVersion).toBe("0.2.0");
  });
});

describe("formatChangelog", () => {
  const issues = [
    { issueNumber: 150, subject: "Centralize date-range validation" },
    { issueNumber: 134, subject: "Extract amountColorClass" },
  ];
  const other = ["Clean up .gitignore files (#154) (385ed7a)"];
  const slug = "aellington89/finance-stack";

  it("includes the suggested version heading", () => {
    const out = formatChangelog(issues, other, "0.1.4", "patch", slug, "2026-06-28");
    expect(out).toContain("## [0.1.4] - 2026-06-28");
  });

  it("includes a confirm-before-tagging note in the heading comment", () => {
    const out = formatChangelog(issues, other, "0.1.4", "patch", slug, "2026-06-28");
    expect(out).toContain("confirm before tagging");
  });

  it("links each issue to its GitHub URL", () => {
    const out = formatChangelog(issues, other, "0.1.4", "patch", slug, "2026-06-28");
    expect(out).toContain("https://github.com/aellington89/finance-stack/issues/150");
    expect(out).toContain("[Issue #150]");
  });

  it("includes the Other section", () => {
    const out = formatChangelog(issues, other, "0.1.4", "patch", slug, "2026-06-28");
    expect(out).toContain("### Other");
    expect(out).toContain("385ed7a");
  });

  it("omits Other section when there are no other commits", () => {
    const out = formatChangelog(issues, [], "0.1.4", "patch", slug, "2026-06-28");
    expect(out).not.toContain("### Other");
  });

  it("emits a placeholder comment when there are no issue entries", () => {
    const out = formatChangelog([], [], "0.1.4", "patch", slug, "2026-06-28");
    expect(out).toContain("No Issue #N commits found");
  });
});

describe("formatRelease", () => {
  const issues = [{ issueNumber: 150, subject: "Centralize date-range validation" }];
  const other = ["Some freeform commit (abc1234)"];
  const slug = "aellington89/finance-stack";

  it("includes the version heading", () => {
    const out = formatRelease(issues, other, "0.1.4", "patch", slug);
    expect(out).toContain("## v0.1.4");
  });

  it("includes the bump type callout", () => {
    const out = formatRelease(issues, other, "0.1.4", "patch", slug);
    expect(out).toContain("**Suggested bump:** patch");
  });

  it("links each issue correctly", () => {
    const out = formatRelease(issues, other, "0.1.4", "patch", slug);
    expect(out).toContain("[Issue #150](https://github.com/aellington89/finance-stack/issues/150)");
  });

  it("includes Other section when present", () => {
    const out = formatRelease(issues, other, "0.1.4", "patch", slug);
    expect(out).toContain("### Other");
    expect(out).toContain("abc1234");
  });
});
