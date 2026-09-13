// Pure parse + format helpers backing the release-notes I/O wrapper
// (app/scripts/release-notes.ts). Kept side-effect-free so the unit suite can
// exercise all logic against inline fixtures without touching git, the GitHub
// API, or the filesystem. See Issue #170.

import type { MigrationKind } from "@/lib/changelog";
import { VERSION_RE } from "@/scripts/check-changelog-core";

export interface ParsedCommit {
  hash: string;
  issueNumber: number | null;
  prRef: number | null;
  subject: string;
}

export interface IssueEntry {
  issueNumber: number;
  subject: string;
}

// Parse `git log --oneline` output into typed commit records.
// Recognized forms (in priority order):
//   "abc1234 Issue #N - <subject>"  → issue commit
//   "abc1234 <anything> (#N)"       → PR-ref commit
//   "abc1234 <anything>"            → freeform commit
export function parseCommits(gitLogOneline: string): ParsedCommit[] {
  const issueRe = /^([0-9a-f]+) Issue #(\d+) - (.+)$/i;
  const prRefRe = /^([0-9a-f]+) (.*)\(#(\d+)\)\s*$/;

  return gitLogOneline
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): ParsedCommit => {
      const issueMatch = issueRe.exec(line);
      if (issueMatch) {
        return {
          hash: issueMatch[1],
          issueNumber: Number(issueMatch[2]),
          prRef: null,
          subject: issueMatch[3].trim(),
        };
      }

      const prMatch = prRefRe.exec(line);
      if (prMatch) {
        return {
          hash: prMatch[1],
          issueNumber: null,
          prRef: Number(prMatch[3]),
          subject: (prMatch[2] + `(#${prMatch[3]})`).trim(),
        };
      }

      const spaceIdx = line.indexOf(" ");
      return {
        hash: spaceIdx === -1 ? line : line.slice(0, spaceIdx),
        issueNumber: null,
        prRef: null,
        subject: spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim(),
      };
    });
}

// Deduplicate issue commits (first-seen wins) and collect the rest as "Other"
// strings formatted for direct inclusion in output.
export function groupCommits(commits: ParsedCommit[]): {
  issues: IssueEntry[];
  other: string[];
} {
  const seen = new Set<number>();
  const issues: IssueEntry[] = [];
  const other: string[] = [];

  for (const commit of commits) {
    if (commit.issueNumber !== null) {
      if (!seen.has(commit.issueNumber)) {
        seen.add(commit.issueNumber);
        issues.push({ issueNumber: commit.issueNumber, subject: commit.subject });
      }
    } else if (commit.prRef !== null) {
      other.push(`${commit.subject} (${commit.hash})`);
    } else {
      other.push(`${commit.subject} (${commit.hash})`);
    }
  }

  return { issues, other };
}

// A suggested bump, and the reason for it. `source` is rendered into the output
// so a drafter confirming the heading sees what drove the number rather than
// rubber-stamping it. Issue #315.
export type BumpKind = "major" | "minor" | "patch";
export const BUMP_KINDS = ["major", "minor", "patch"] as const;

export type BumpSource =
  | "override"
  | "breaking-migration"
  | "enhancement-label"
  | "default";

export interface BumpSuggestion {
  nextVersion: string;
  bump: BumpKind;
  source: BumpSource;
}

// Mirrors isMigrationKind() in lib/changelog.ts, so the wrapper validates
// `--bump=` against this list rather than against a second copy of it.
export function isBumpKind(value: string): value is BumpKind {
  return (BUMP_KINDS as readonly string[]).includes(value);
}

// Suggest the next semver string from the current version, a map of
// issue-number -> label-names, and the `**Migration:**` marker standing on
// [Unreleased].
//
// The rule: a breaking migration escalates the bump — to a major at >= 1.0, to a
// minor below it, where a breaking change legitimately ships as a minor.
// Otherwise any `enhancement` label is a minor and everything else a patch.
// Before Issue #315 there was no major path at all, and the comment here claimed
// pre-1.0 `0.MINOR.PATCH` versioning — an assumption that went stale at v1.0.0
// and would have proposed 1.0.1 for a release that ought to be 2.0.0.
//
// The pre-1.0 branch is unreachable in this repository — package.json is past
// 1.0.0 and versions do not go backwards — but it is what lets the rule be
// stated in one sentence, and the untouched pre-1.0 tests are the evidence that
// #315 changed nothing about how past releases were numbered.
//
// `currentVersion` is the *last released* version: the procedure drafts notes
// before `npm version X.Y.Z` (docs/releases.md step 1, CONTRIBUTING.md step 3),
// so package.json still holds the previous number when this runs. The major
// arithmetic makes that ordering matter more than it used to.
//
// The marker is a *schema-rollback* axis — "the previous app version does not run
// against the new schema" — not an API-compatibility one. The two coincide for
// this product but are not the same thing: a removed env var or a changed deploy
// contract is a major that ships `**Migration:** none`, and nothing here can see
// it. `override` (the wrapper's `--bump=`) is the designated way to say so; a
// `breaking` *label* is deliberately not consulted, because a branch nothing can
// exercise is untestable policy that would change behaviour the day someone
// creates such a label for an unrelated reason. See docs/releases.md.
//
// Both new parameters are optional so that every pre-#315 call — and every test
// written against it — keeps its exact previous meaning.
export function suggestBump(
  currentVersion: string,
  labelsByIssue: Map<number, string[]>,
  unreleasedMigration?: MigrationKind | null,
  override?: BumpKind | null,
): BumpSuggestion {
  // VERSION_RE rather than a part count: "1.0.x" also splits into three, and
  // would otherwise reach the arithmetic as [1, 0, NaN] and print "1.0.NaN".
  const [major, minor, patch] = VERSION_RE.test(currentVersion)
    ? currentVersion.split(".").map(Number)
    : [0, 0, 0];

  const allLabels = [...labelsByIssue.values()].flat();

  let bump: BumpKind;
  let source: BumpSource;
  if (override != null) {
    bump = override;
    source = "override";
  } else if (unreleasedMigration === "breaking") {
    bump = major >= 1 ? "major" : "minor";
    source = "breaking-migration";
  } else if (allLabels.some((l) => l === "enhancement")) {
    bump = "minor";
    source = "enhancement-label";
  } else {
    bump = "patch";
    source = "default";
  }

  const nextVersion =
    bump === "major"
      ? `${major + 1}.0.0`
      : bump === "minor"
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`;

  return { nextVersion, bump, source };
}

// Why this bump, in a few words, for the reader of the generated block.
function sourceNote(source: BumpSource): string {
  switch (source) {
    case "override":
      return "--bump=";
    case "breaking-migration":
      return "[Unreleased] declares Migration: breaking";
    case "enhancement-label":
      return "enhancement label";
    case "default":
      return "no enhancement label, no breaking migration";
  }
}

// An overridden bump is an instruction the tool is echoing, not a suggestion it
// derived; saying "Suggested" of it would overstate what the tool knows.
function bumpHeadline(suggestion: BumpSuggestion): string {
  if (suggestion.source === "override") {
    return `Requested: ${suggestion.bump} bump (--bump=${suggestion.bump}) — confirm before tagging`;
  }
  return `Suggested: ${suggestion.bump} bump (${sourceNote(suggestion.source)}) — confirm before tagging`;
}

// The marker cannot see a breaking change that ships no migration, so at >= 1.0
// a derived non-major suggestion carries a reminder that the drafter may have to
// say so themselves. Omitted when the bump is already major (the gap is closed),
// when it was overridden (they have demonstrably thought about it), and pre-1.0
// (a breaking change is a minor there either way).
//
// An HTML comment rather than prose, matching the other drafter instructions in
// this block: unlike the **Migration:** placeholder, this is advice, and advice
// that survives an unedited paste should be invisible rather than loud.
function majorCaution(suggestion: BumpSuggestion): string | null {
  if (suggestion.bump === "major" || suggestion.source === "override") return null;
  if (Number(suggestion.nextVersion.split(".")[0]) < 1) return null;
  return [
    "<!--",
    "  Post-1.0, a major is suggested only when [Unreleased] declares **Migration:** breaking.",
    "  That marker is a schema-rollback signal, not an API-compatibility one: if this release",
    "  removes an env var, changes the deploy contract, or breaks any other published interface,",
    "  re-run with --bump=major.",
    "",
    "  It is also read from the working tree, so a maintenance release cut from an older tag is",
    "  described by a marker covering work that release does not ship. See docs/releases.md.",
    "-->",
  ].join("\n");
}

function issueLink(entry: IssueEntry, repoSlug: string): string {
  return `- ${entry.subject} ([Issue #${entry.issueNumber}](https://github.com/${repoSlug}/issues/${entry.issueNumber}))`;
}

// Emit a Keep-a-Changelog heading block ready for pasting into CHANGELOG.md.
export function formatChangelog(
  issues: IssueEntry[],
  other: string[],
  suggestion: BumpSuggestion,
  repoSlug: string,
  today: string,
): string {
  const lines: string[] = [];

  // The migration placeholder is deliberately not one of the three legal values
  // (Issue #277): a drafter who pastes the block without choosing one trips the
  // changelog gate on their own branch rather than at tag time. It stays illegal
  // even though #315 now reads a real marker off [Unreleased] — pre-filling a
  // legal value would pass the gate with nobody having chosen it, which is the
  // #277 failure wearing a solved face. The marker drives the bump; it does not
  // answer the question the placeholder asks.
  lines.push(
    `## [${suggestion.nextVersion}] - ${today}  <!-- ${bumpHeadline(suggestion)} -->`,
  );

  const caution = majorCaution(suggestion);
  if (caution !== null) lines.push(caution);

  lines.push(
    "",
    `**Migration:** <none|backward-compatible|breaking>`,
    "",
    `<!-- Re-sort into Added / Changed / Fixed before committing to CHANGELOG.md -->`,
  );

  if (issues.length > 0) {
    for (const entry of issues) {
      lines.push(issueLink(entry, repoSlug));
    }
  } else {
    lines.push("<!-- No Issue #N commits found in this range -->");
  }

  if (other.length > 0) {
    lines.push("", "### Other");
    for (const item of other) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n");
}

// Emit a GitHub Release body. No caution comment here: this output is the body
// of a published Release, and a semver lecture has no audience there.
export function formatRelease(
  issues: IssueEntry[],
  other: string[],
  suggestion: BumpSuggestion,
  repoSlug: string,
): string {
  const lines: string[] = [];

  lines.push(
    `## v${suggestion.nextVersion}`,
    "",
    `**Suggested bump:** ${suggestion.bump} (${sourceNote(suggestion.source)}) — confirm before tagging.`,
    "",
    "### Changes",
  );

  if (issues.length > 0) {
    for (const entry of issues) {
      lines.push(issueLink(entry, repoSlug));
    }
  } else {
    lines.push("<!-- No Issue #N commits found in this range -->");
  }

  if (other.length > 0) {
    lines.push("", "### Other");
    for (const item of other) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n");
}
