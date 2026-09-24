// Pure version/changelog/tag consistency checks backing the changelog CI gate
// (app/scripts/check-changelog.ts). Side-effect-free — no I/O, no process.exit —
// so the unit suite exercises every branch against inline fixtures. Mirrors
// seed-reference-check.ts. See Issue #173 and docs/releases.md.
//
// Issue #277 added the migration-reversibility assertion. drizzle-kit generates
// no down migrations, so rolling back across a schema change means restoring the
// pre-upgrade dump — a fact an operator otherwise discovers at the worst possible
// moment. Each release declares its own impact and this gate refuses to let one
// ship without saying.

import type { ChangelogRelease } from "@/lib/changelog";

export const VERSION_RE = /^\d+\.\d+\.\d+$/; // X.Y.Z  (package.json / changelog)
export const RELEASE_TAG_RE = /^v\d+\.\d+\.\d+$/; // vX.Y.Z (docs/releases.md, #167)

export type ChangelogProblem =
  | { kind: "no-releases"; pkgVersion: string }
  | { kind: "version-mismatch"; pkgVersion: string; changelogVersion: string }
  | { kind: "tag-format"; tag: string }
  | { kind: "tag-mismatch"; tag: string; expected: string }
  | { kind: "missing-migration-marker"; version: string }
  | { kind: "bad-migration-marker"; version: string; value: string }
  | { kind: "breaking-not-major"; version: string; previous: string; expected: string };

// First heading whose version is X.Y.Z — skips [Unreleased] / non-semver. null if none.
export function newestRelease(releases: ChangelogRelease[]): ChangelogRelease | null {
  for (const r of releases) if (VERSION_RE.test(r.version)) return r;
  return null;
}

export function newestReleaseVersion(releases: ChangelogRelease[]): string | null {
  return newestRelease(releases)?.version ?? null;
}

// A marker is *required* only on the release being tagged — [Unreleased] is
// exempt, which newestRelease() gives for free by skipping non-semver headings.
// A marker that is present but unrecognized is rejected wherever it appears,
// [Unreleased] included: a typo should fail on the branch that introduced it
// rather than reappear as a missing marker when that section is closed.
export function checkMigrationMarkers(releases: ChangelogRelease[]): ChangelogProblem[] {
  const problems: ChangelogProblem[] = [];

  for (const r of releases) {
    if (r.migrationRaw !== null && r.migration === null) {
      problems.push({ kind: "bad-migration-marker", version: r.version, value: r.migrationRaw });
    }
  }

  const newest = newestRelease(releases);
  if (newest !== null && newest.migrationRaw === null) {
    problems.push({ kind: "missing-migration-marker", version: newest.version });
  }

  return problems;
}

// A release declaring **Migration:** breaking cannot be rolled back by re-pinning
// the previous image — the previous app version does not run against the new
// schema — so post-1.0 it is a major. Nothing else compares the version against
// the *content* of the release: package.json, the newest changelog heading and
// the tag can all agree on an understated number, which is the worst place for a
// version to be wrong. See Issue #315 and docs/roadmap.md's "breaking → major".
//
// Deliberately *not* rules, because they are the first things a reader asks:
// a major that declares `none` is fine (v1.0.0 is exactly that), and a breaking
// release that skips a major (1.4.2 → 3.0.0) is legal semver — hence the
// comparison is "did not increment" rather than "is previous + 1". Pre-1.0 is
// exempt: a breaking change legitimately ships as a 0.x minor there.
//
// Scoped to the release being closed, like missing-migration-marker above: that
// is the one a drafter is choosing a number for, and history is not relitigated.
export function checkBreakingIsMajor(releases: ChangelogRelease[]): ChangelogProblem[] {
  // The filter is also the validation — [Unreleased] and any malformed heading
  // can never enter the pair.
  const [current, previous] = releases.filter((r) => VERSION_RE.test(r.version));
  if (current === undefined || previous === undefined) return [];
  // `migration`, never `migrationRaw`: a malformed "Breaking" is already reported
  // as bad-migration-marker, and reading it as breaking here would contradict
  // lib/changelog.ts's refusal to coerce it.
  if (current.migration !== "breaking") return [];

  const currentMajor = Number(current.version.split(".")[0]);
  const previousMajor = Number(previous.version.split(".")[0]);
  if (previousMajor < 1) return [];
  if (currentMajor > previousMajor) return [];

  return [
    {
      kind: "breaking-not-major",
      version: current.version,
      previous: previous.version,
      expected: `${previousMajor + 1}.0.0`,
    },
  ];
}

export function checkChangelog(
  pkgVersion: string,
  releases: ChangelogRelease[],
): ChangelogProblem[] {
  const newest = newestReleaseVersion(releases);
  if (newest === null) return [{ kind: "no-releases", pkgVersion }];
  if (newest !== pkgVersion) return [{ kind: "version-mismatch", pkgVersion, changelogVersion: newest }];
  // Marker and bump problems are reported only once the version agrees: a mismatch
  // is the more fundamental failure, and fixing it changes which release is being
  // checked.
  return [...checkMigrationMarkers(releases), ...checkBreakingIsMajor(releases)];
}

// Combined with checkChangelog, enforces tag === v<version> === CHANGELOG top.
export function checkTag(tag: string, pkgVersion: string): ChangelogProblem[] {
  if (!RELEASE_TAG_RE.test(tag)) return [{ kind: "tag-format", tag }];
  const expected = `v${pkgVersion}`;
  if (tag !== expected) return [{ kind: "tag-mismatch", tag, expected }];
  return [];
}
