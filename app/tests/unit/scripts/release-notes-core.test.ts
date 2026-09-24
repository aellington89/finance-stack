import { describe, expect, it } from "vitest";
import {
  type BumpKind,
  type BumpSource,
  type BumpSuggestion,
  formatChangelog,
  formatRelease,
  groupCommits,
  isBumpKind,
  labelRefs,
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

describe("labelRefs", () => {
  it("collects both the issue and the PR ref of an issue commit", () => {
    const commits = parseCommits("1bb8e3b Issue #296 - React component coverage (#343)");
    expect(labelRefs(commits).sort()).toEqual([296, 343]);
  });

  // The shape that hid #237's enhancement label: a freeform squash title carrying
  // the issue ref ahead of the PR ref. parseCommits keeps only the last as prRef.
  it("collects every (#N) in a freeform title, not only the trailing PR ref", () => {
    const commits = parseCommits(
      "f551ebf Nonce-based CSP: remove 'unsafe-inline' from script-src (#237) (#333)",
    );
    expect(labelRefs(commits).sort()).toEqual([237, 333]);
  });

  it("deduplicates refs repeated across commits", () => {
    expect(labelRefs(parseCommits(GIT_LOG)).sort()).toEqual([134, 150, 154]);
  });

  it("returns nothing for commits that reference no issue or PR", () => {
    expect(labelRefs(parseCommits("1df841c Replace pull-based drift gate"))).toEqual([]);
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

  // Issue #315. Everything above this line predates it and is deliberately left
  // byte-identical: those six calls pass two arguments, so their passing is the
  // evidence that adding a major path changed nothing about how the pre-1.0
  // releases in CHANGELOG.md were numbered.

  it("suggests a major at 1.x when [Unreleased] declares Migration: breaking", () => {
    expect(suggestBump("1.0.2", new Map(), "breaking")).toMatchObject({
      bump: "major",
      nextVersion: "2.0.0",
      source: "breaking-migration",
    });
  });

  it("zeros both minor and patch on a major bump", () => {
    expect(suggestBump("1.4.7", new Map(), "breaking").nextVersion).toBe("2.0.0");
  });

  it("prefers major over an enhancement label when both apply", () => {
    const labels = new Map([[134, ["enhancement"]]]);
    expect(suggestBump("1.0.2", labels, "breaking").bump).toBe("major");
  });

  it("suggests a minor at 1.x for an enhancement label under a backward-compatible marker", () => {
    expect(suggestBump("1.0.2", new Map([[1, ["enhancement"]]]), "backward-compatible")).toMatchObject({
      bump: "minor",
      nextVersion: "1.1.0",
      source: "enhancement-label",
    });
  });

  it("suggests a patch at 1.x when the marker is none", () => {
    expect(suggestBump("1.0.2", new Map([[1, ["bug"]]]), "none")).toMatchObject({
      bump: "patch",
      nextVersion: "1.0.3",
      source: "default",
    });
  });

  it("suggests a patch at 1.x when the marker is absent rather than guessing", () => {
    expect(suggestBump("1.0.2", new Map([[1, ["bug"]]]), null).nextVersion).toBe("1.0.3");
  });

  // The boundary the issue is about: the same breaking marker means different
  // things either side of 1.0.0.
  it("applies pre-1.0 rules at 0.9.9 and post-1.0 rules at 1.0.0", () => {
    expect(suggestBump("0.9.9", new Map(), "breaking")).toMatchObject({
      bump: "minor",
      nextVersion: "0.10.0",
    });
    expect(suggestBump("1.0.0", new Map(), "breaking")).toMatchObject({
      bump: "major",
      nextVersion: "2.0.0",
    });
  });

  it("escalates a pre-1.0 breaking marker to a minor rather than a patch", () => {
    expect(suggestBump("0.4.1", new Map(), "breaking")).toMatchObject({
      bump: "minor",
      nextVersion: "0.5.0",
    });
  });

  it("leaves a pre-1.0 backward-compatible marker on the patch path", () => {
    expect(suggestBump("0.1.3", new Map([[1, ["bug"]]]), "backward-compatible").nextVersion).toBe("0.1.4");
  });

  it("honours an explicit override ahead of both the marker and the labels", () => {
    expect(suggestBump("1.0.2", new Map([[1, ["enhancement"]]]), "none", "major")).toMatchObject({
      bump: "major",
      nextVersion: "2.0.0",
      source: "override",
    });
  });

  // The override lowers as well as raises: it means "I have looked and I know",
  // and a flag that can only escalate cannot express a breaking marker that
  // overstates the impact. The wrapper warns when this combination is used.
  it("honours an override that narrows a breaking marker", () => {
    expect(suggestBump("1.0.2", new Map(), "breaking", "patch").nextVersion).toBe("1.0.3");
  });

  it("honours a major override pre-1.0 — the 0.4.1 to 1.0.0 cut", () => {
    expect(suggestBump("0.4.1", new Map(), null, "major").nextVersion).toBe("1.0.0");
  });

  // An ### Added entry is a minor on its own, whatever the labels say. The
  // labels here are #124's and #232's: both shipped features, neither carried
  // enhancement, and [Unreleased] holding them drafted as 1.0.5.
  it("suggests a minor at 1.x for an ### Added entry with no enhancement label", () => {
    const labels = new Map([
      [124, ["bug", "infrastructure", "backend"]],
      [232, ["infrastructure", "backend"]],
    ]);
    expect(suggestBump("1.0.4", labels, "backward-compatible", null, true)).toMatchObject({
      bump: "minor",
      nextVersion: "1.1.0",
      source: "added-section",
    });
  });

  it("names the ### Added entry ahead of an enhancement label when both apply", () => {
    expect(
      suggestBump("1.0.4", new Map([[1, ["enhancement"]]]), "none", null, true).source,
    ).toBe("added-section");
  });

  it("falls through to the labels when [Unreleased] has no ### Added entry", () => {
    expect(suggestBump("1.0.4", new Map([[1, ["bug"]]]), "none", null, false)).toMatchObject({
      bump: "patch",
      source: "default",
    });
  });

  it("still prefers a breaking marker to an ### Added entry", () => {
    expect(suggestBump("1.0.4", new Map(), "breaking", null, true).bump).toBe("major");
  });

  it("still honours an override ahead of an ### Added entry", () => {
    expect(suggestBump("1.0.4", new Map(), "none", "patch", true).nextVersion).toBe("1.0.5");
  });

  it("treats an ### Added entry as a minor pre-1.0 too", () => {
    expect(suggestBump("0.4.1", new Map(), null, null, true).nextVersion).toBe("0.5.0");
  });

  // Regression guard: "1.0.x" also splits into three parts, so the old
  // parts.length === 3 check let it through as [1, 0, NaN] and printed "1.0.NaN".
  it("falls back to 0.0.0 for a version string that is not X.Y.Z", () => {
    const { nextVersion } = suggestBump("1.0.x", new Map());
    expect(nextVersion).toBe("0.0.1");
    expect(nextVersion).not.toContain("NaN");
  });

  it("falls back for a two-component version", () => {
    expect(suggestBump("1.0", new Map()).nextVersion).toBe("0.0.1");
  });
});

// Exported from this module but called only from the coverage-excluded wrapper,
// so it needs direct coverage of its own.
describe("isBumpKind", () => {
  it("accepts each of the three bump kinds", () => {
    expect(isBumpKind("major")).toBe(true);
    expect(isBumpKind("minor")).toBe(true);
    expect(isBumpKind("patch")).toBe(true);
  });

  it("rejects an unrecognized or mis-cased value", () => {
    expect(isBumpKind("Major")).toBe(false);
    expect(isBumpKind("breaking")).toBe(false);
    expect(isBumpKind("")).toBe(false);
  });
});

const bumpOf = (
  nextVersion: string,
  bump: BumpKind,
  source: BumpSource,
): BumpSuggestion => ({ nextVersion, bump, source });

const PATCH = bumpOf("0.1.4", "patch", "default");

describe("formatChangelog", () => {
  const issues = [
    { issueNumber: 150, subject: "Centralize date-range validation" },
    { issueNumber: 134, subject: "Extract amountColorClass" },
  ];
  const other = ["Clean up .gitignore files (#154) (385ed7a)"];
  const slug = "aellington89/finance-stack";

  it("includes the suggested version heading", () => {
    const out = formatChangelog(issues, other, PATCH, slug, "2026-06-28");
    expect(out).toContain("## [0.1.4] - 2026-06-28");
  });

  it("includes a confirm-before-tagging note in the heading comment", () => {
    const out = formatChangelog(issues, other, PATCH, slug, "2026-06-28");
    expect(out).toContain("confirm before tagging");
  });

  // Issue #277. The placeholder is deliberately not a legal kind, so pasting the
  // block unedited trips the changelog gate instead of shipping an undeclared
  // migration impact.
  it("emits a Migration marker placeholder that is not itself a legal kind", () => {
    const out = formatChangelog(issues, other, PATCH, slug, "2026-06-28");
    expect(out).toContain("**Migration:** <none|backward-compatible|breaking>");
  });

  // Issue #315 gave the generator a real marker to read. It must not pre-fill
  // the placeholder with it: a legal value nobody chose would pass the #277 gate
  // while defeating its purpose.
  it("still emits the illegal placeholder when [Unreleased] declared a real marker", () => {
    const major = bumpOf("2.0.0", "major", "breaking-migration");
    const out = formatChangelog(issues, other, major, slug, "2026-06-28");
    expect(out).toContain("**Migration:** <none|backward-compatible|breaking>");
  });

  it("links each issue to its GitHub URL", () => {
    const out = formatChangelog(issues, other, PATCH, slug, "2026-06-28");
    expect(out).toContain("https://github.com/aellington89/finance-stack/issues/150");
    expect(out).toContain("[Issue #150]");
  });

  it("includes the Other section", () => {
    const out = formatChangelog(issues, other, PATCH, slug, "2026-06-28");
    expect(out).toContain("### Other");
    expect(out).toContain("385ed7a");
  });

  it("omits Other section when there are no other commits", () => {
    const out = formatChangelog(issues, [], PATCH, slug, "2026-06-28");
    expect(out).not.toContain("### Other");
  });

  it("emits a placeholder comment when there are no issue entries", () => {
    const out = formatChangelog([], [], PATCH, slug, "2026-06-28");
    expect(out).toContain("No Issue #N commits found");
  });

  // Issue #315.
  it("renders a major suggestion and names the marker that drove it", () => {
    const major = bumpOf("2.0.0", "major", "breaking-migration");
    const out = formatChangelog(issues, other, major, slug, "2026-06-28");
    expect(out).toContain("## [2.0.0] - 2026-06-28");
    expect(out).toContain("Suggested: major bump ([Unreleased] declares Migration: breaking)");
  });

  it("says an overridden bump was requested rather than suggested", () => {
    const forced = bumpOf("2.0.0", "major", "override");
    const out = formatChangelog(issues, other, forced, slug, "2026-06-28");
    expect(out).toContain("Requested: major bump (--bump=major)");
    expect(out).not.toContain("Suggested: major bump");
  });

  it("emits the schema-vs-API caution at 1.x when the bump is not major", () => {
    const out = formatChangelog(issues, other, bumpOf("1.0.3", "patch", "default"), slug, "2026-06-28");
    expect(out).toContain("re-run with --bump=major");
  });

  it("omits the caution pre-1.0, where a breaking change is a minor anyway", () => {
    const out = formatChangelog(issues, other, PATCH, slug, "2026-06-28");
    expect(out).not.toContain("re-run with --bump=major");
  });

  it("omits the caution when the suggestion is already major", () => {
    const major = bumpOf("2.0.0", "major", "breaking-migration");
    const out = formatChangelog(issues, other, major, slug, "2026-06-28");
    expect(out).not.toContain("re-run with --bump=major");
  });

  it("omits the caution when the bump was explicitly overridden", () => {
    const forced = bumpOf("1.0.3", "patch", "override");
    const out = formatChangelog(issues, other, forced, slug, "2026-06-28");
    expect(out).not.toContain("re-run with --bump=major");
  });
});

describe("formatRelease", () => {
  const issues = [{ issueNumber: 150, subject: "Centralize date-range validation" }];
  const other = ["Some freeform commit (abc1234)"];
  const slug = "aellington89/finance-stack";

  it("includes the version heading", () => {
    const out = formatRelease(issues, other, PATCH, slug);
    expect(out).toContain("## v0.1.4");
  });

  it("includes the bump type callout", () => {
    const out = formatRelease(issues, other, PATCH, slug);
    expect(out).toContain("**Suggested bump:** patch");
  });

  it("links each issue correctly", () => {
    const out = formatRelease(issues, other, PATCH, slug);
    expect(out).toContain("[Issue #150](https://github.com/aellington89/finance-stack/issues/150)");
  });

  it("includes Other section when present", () => {
    const out = formatRelease(issues, other, PATCH, slug);
    expect(out).toContain("### Other");
    expect(out).toContain("abc1234");
  });

  // Issue #315.
  it("renders a major suggested bump", () => {
    const major = bumpOf("2.0.0", "major", "breaking-migration");
    const out = formatRelease(issues, other, major, slug);
    expect(out).toContain("## v2.0.0");
    expect(out).toContain("**Suggested bump:** major");
  });

  // This output is the body of a published Release; a semver lecture aimed at
  // the drafter has no audience there.
  it("never carries the changelog caution comment into the release body", () => {
    const out = formatRelease(issues, other, bumpOf("1.0.3", "patch", "default"), slug);
    expect(out).not.toContain("re-run with --bump=major");
  });

  it("notes an overridden bump in the release body", () => {
    const out = formatRelease(issues, other, bumpOf("2.0.0", "major", "override"), slug);
    expect(out).toContain("**Suggested bump:** major (--bump=)");
  });

  it("names an enhancement label as the reason for a minor", () => {
    const out = formatRelease(issues, other, bumpOf("1.1.0", "minor", "enhancement-label"), slug);
    expect(out).toContain("**Suggested bump:** minor (enhancement label)");
  });

  it("names an ### Added entry as the reason for a minor", () => {
    const out = formatRelease(issues, other, bumpOf("1.1.0", "minor", "added-section"), slug);
    expect(out).toContain("**Suggested bump:** minor ([Unreleased] has an ### Added entry)");
  });

  it("names every signal it checked when it falls back to a patch", () => {
    const out = formatRelease(issues, other, bumpOf("1.0.5", "patch", "default"), slug);
    expect(out).toContain("no ### Added entry, no enhancement label, no breaking migration");
  });

  it("emits a placeholder comment when there are no issue entries", () => {
    expect(formatRelease([], other, PATCH, slug)).toContain("No Issue #N commits found");
  });

  it("omits the Other section when there are no other commits", () => {
    expect(formatRelease(issues, [], PATCH, slug)).not.toContain("### Other");
  });
});
