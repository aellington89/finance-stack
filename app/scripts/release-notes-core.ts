// Pure parse + format helpers backing the release-notes I/O wrapper
// (app/scripts/release-notes.ts). Kept side-effect-free so the unit suite can
// exercise all logic against inline fixtures without touching git, the GitHub
// API, or the filesystem. See Issue #170.

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

// Suggest the next semver string from the current version and a map of
// issue-number → label-names. Any `enhancement` label triggers a minor bump;
// everything else is a patch. Assumes pre-1.0 `0.MINOR.PATCH` versioning.
export function suggestBump(
  currentVersion: string,
  labelsByIssue: Map<number, string[]>,
): { nextVersion: string; bump: "minor" | "patch" } {
  const allLabels = [...labelsByIssue.values()].flat();
  const bump: "minor" | "patch" = allLabels.some((l) => l === "enhancement")
    ? "minor"
    : "patch";

  const parts = currentVersion.split(".").map(Number);
  const [major, minor, patch] = parts.length === 3 ? parts : [0, 0, 0];

  const nextVersion =
    bump === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

  return { nextVersion, bump };
}

function issueLink(entry: IssueEntry, repoSlug: string): string {
  return `- ${entry.subject} ([Issue #${entry.issueNumber}](https://github.com/${repoSlug}/issues/${entry.issueNumber}))`;
}

// Emit a Keep-a-Changelog heading block ready for pasting into CHANGELOG.md.
export function formatChangelog(
  issues: IssueEntry[],
  other: string[],
  nextVersion: string,
  bump: "minor" | "patch",
  repoSlug: string,
  today: string,
): string {
  const lines: string[] = [];

  lines.push(
    `## [${nextVersion}] - ${today}  <!-- Suggested: ${bump} bump — confirm before tagging -->`,
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

// Emit a GitHub Release body.
export function formatRelease(
  issues: IssueEntry[],
  other: string[],
  nextVersion: string,
  bump: "minor" | "patch",
  repoSlug: string,
): string {
  const lines: string[] = [];

  lines.push(
    `## v${nextVersion}`,
    "",
    `**Suggested bump:** ${bump} — confirm before tagging.`,
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
