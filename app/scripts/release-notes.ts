// I/O wrapper for the release-notes generator. Reads git log, fetches GitHub
// issue and PR labels via `gh`, and delegates all logic to the pure core module so
// the core stays unit-testable. See Issue #170.
//
// Usage: tsx scripts/release-notes.ts <git-range> [--changelog|--release] [--bump=<kind>]
// Example: npm run release:notes -- v0.1.3..HEAD --changelog

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type MigrationKind, parseChangelog } from "@/lib/changelog";
import {
  BUMP_KINDS,
  type BumpKind,
  formatChangelog,
  formatRelease,
  groupCommits,
  isBumpKind,
  labelRefs,
  parseCommits,
  suggestBump,
} from "@/scripts/release-notes-core";

const HERE = dirname(fileURLToPath(import.meta.url));
// This file lives at app/scripts/, so ../../ is the repo root. Script-relative
// rather than readChangelog()'s cwd-based lookup, matching readCurrentVersion()
// below and check-changelog.ts — the release flows run from more than one cwd.
const CHANGELOG_PATH = resolve(HERE, "../../CHANGELOG.md");

function usage(detail?: string): never {
  if (detail) console.error(`Error: ${detail}\n`);
  console.error(
    "Usage: tsx scripts/release-notes.ts <git-range> [--changelog|--release] " +
      `[--bump=${BUMP_KINDS.join("|")}]\n` +
      "  Example: npm run release:notes -- v0.1.3..HEAD --changelog\n" +
      "  Default output mode: --changelog\n" +
      "  --bump= overrides the derived suggestion. The value must be attached with\n" +
      "  '=' — a space-separated one would be read as the git range instead.",
  );
  process.exit(1);
}

// What [Unreleased] says about the bump: its `**Migration:**` marker (Issue
// #315) and whether it carries an `### Added` entry. Every failure degrades to
// null / false, which falls through to the label/patch path — the safe
// direction, since it can never over-suggest off a bad read. Warnings go to
// stderr, like fetchLabels' below: console.log is the only stdout write here
// precisely so the block stays pasteable.
interface UnreleasedSignals {
  migration: MigrationKind | null;
  added: boolean;
}

function readUnreleased(): UnreleasedSignals {
  const none: UnreleasedSignals = { migration: null, added: false };
  let raw: string;
  try {
    raw = readFileSync(CHANGELOG_PATH, "utf8");
  } catch {
    console.warn(
      `Warning: could not read ${CHANGELOG_PATH} — the suggested bump cannot see the ` +
        "[Unreleased] section. Pass --bump= if this release is breaking or adds a feature.",
    );
    return none;
  }

  // The literal heading text, per RELEASE_RE in lib/changelog.ts.
  const unreleased = parseChangelog(raw).find((r) => r.version === "Unreleased");
  if (!unreleased) {
    console.warn(
      "Warning: CHANGELOG.md has no [Unreleased] section — the suggested bump cannot " +
        "see a migration marker or an ### Added entry. Pass --bump= if this release is " +
        "breaking or adds a feature.",
    );
    return none;
  }

  // An entry, not a heading: an `### Added` left standing with nothing under it
  // is an editing leftover, not a feature.
  const added = unreleased.sections.some((s) => s.heading === "Added" && s.items.length > 0);

  // migrationRaw set with migration null is a malformed value. `npm run
  // check:changelog` is already failing on it; say so rather than reading it as
  // "no marker", which would look like a deliberate absence.
  if (unreleased.migrationRaw !== null && unreleased.migration === null) {
    console.warn(
      `Warning: [Unreleased] declares **Migration:** "${unreleased.migrationRaw}", which is ` +
        "not a recognized value — ignoring it. Run `npm run check:changelog`.",
    );
    return { migration: null, added };
  }

  // A marker-free [Unreleased] is explicitly allowed (CONTRIBUTING.md), so it is
  // the ordinary case for a fix-only release and warrants no warning.
  return { migration: unreleased.migration, added };
}

// --bump=<kind> only. The range is `args.find((a) => !a.startsWith("--"))`, so a
// space-separated `--bump major` would silently make "major" the git range and
// fail somewhere confusing. An unrecognized value exits rather than falling back:
// a silently-ignored `--bump=Major` producing a patch is the very failure class
// Issue #315 exists to close.
function resolveOverride(args: string[]): BumpKind | null {
  if (args.includes("--bump")) {
    usage(`--bump takes its value with '=', e.g. --bump=${BUMP_KINDS[0]}.`);
  }
  const flag = args.find((a) => a.startsWith("--bump="));
  if (flag === undefined) return null;

  const value = flag.slice("--bump=".length);
  if (!isBumpKind(value)) {
    usage(`--bump=${value} is not a recognized bump — expected one of ${BUMP_KINDS.join(", ")} (exact, lower-case).`);
  }
  return value;
}

function readRepoSlug(): string {
  try {
    const remoteUrl = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    // SSH:   git@github.com:owner/repo.git
    // HTTPS: https://github.com/owner/repo.git
    const match =
      /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl);
    return match ? match[1] : "owner/repo";
  } catch {
    return "owner/repo";
  }
}

function fetchLabels(
  issueNumbers: number[],
  repoSlug: string,
): Map<number, string[]> {
  const map = new Map<number, string[]>();
  const [owner, repo] = repoSlug.split("/");

  for (const n of issueNumbers) {
    try {
      const raw = execSync(
        `gh api repos/${owner}/${repo}/issues/${n} --jq '[.labels[].name]'`,
        { encoding: "utf8" },
      ).trim();
      map.set(n, JSON.parse(raw) as string[]);
    } catch {
      console.warn(`Warning: could not fetch labels for #${n} — skipping`);
    }
  }

  return map;
}

function readCurrentVersion(): string {
  const pkgPath = resolve(HERE, "../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  if (pkg.version === undefined) {
    // The 0.0.0 fallback also puts the caller in the pre-1.0 regime, where a
    // breaking marker is ignored. Safe, but it should not look like a pre-1.0
    // repository when it is really an unreadable package.json.
    console.warn('Warning: package.json has no version — falling back to "0.0.0".');
    return "0.0.0";
  }
  return pkg.version;
}

function main(): void {
  const args = process.argv.slice(2);
  const range = args.find((a) => !a.startsWith("--"));
  const mode = args.includes("--release") ? "release" : "changelog";
  const override = resolveOverride(args);

  if (!range) usage("a git range is required.");

  let gitLog: string;
  try {
    gitLog = execSync(`git log --oneline ${range}`, { encoding: "utf8" });
  } catch (err) {
    console.error(`Error running git log for range "${range}": ${String(err)}`);
    process.exit(1);
  }

  const commits = parseCommits(gitLog);
  const { issues, other } = groupCommits(commits);

  const repoSlug = readRepoSlug();
  const labelsByIssue = fetchLabels(labelRefs(commits), repoSlug);
  const currentVersion = readCurrentVersion();
  const unreleased = readUnreleased();
  const unreleasedMigration = unreleased.migration;
  const suggestion = suggestBump(
    currentVersion,
    labelsByIssue,
    unreleasedMigration,
    override,
    unreleased.added,
  );
  const today = new Date().toISOString().slice(0, 10);

  // The only place the generator and the changelog gate are aware of each other:
  // narrowing a breaking release below a major produces a number CI will reject,
  // so say so here rather than at tag time (Issue #315).
  if (
    unreleasedMigration === "breaking" &&
    suggestion.source === "override" &&
    suggestion.bump !== "major" &&
    !suggestion.nextVersion.startsWith("0.")
  ) {
    console.warn(
      `Warning: [Unreleased] declares **Migration:** breaking but --bump=${suggestion.bump} ` +
        `narrows the suggestion to ${suggestion.nextVersion}. If that marker still stands when ` +
        "the section is closed, the changelog gate will reject it — see `npm run check:changelog`.",
    );
  }

  const output =
    mode === "release"
      ? formatRelease(issues, other, suggestion, repoSlug)
      : formatChangelog(issues, other, suggestion, repoSlug, today);

  console.log(output);
}

main();
