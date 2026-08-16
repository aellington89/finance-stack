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
  | { kind: "bad-migration-marker"; version: string; value: string };

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

export function checkChangelog(
  pkgVersion: string,
  releases: ChangelogRelease[],
): ChangelogProblem[] {
  const newest = newestReleaseVersion(releases);
  if (newest === null) return [{ kind: "no-releases", pkgVersion }];
  if (newest !== pkgVersion) return [{ kind: "version-mismatch", pkgVersion, changelogVersion: newest }];
  // Marker problems are reported only once the version agrees: a mismatch is the
  // more fundamental failure, and fixing it changes which release is being checked.
  return checkMigrationMarkers(releases);
}

// Combined with checkChangelog, enforces tag === v<version> === CHANGELOG top.
export function checkTag(tag: string, pkgVersion: string): ChangelogProblem[] {
  if (!RELEASE_TAG_RE.test(tag)) return [{ kind: "tag-format", tag }];
  const expected = `v${pkgVersion}`;
  if (tag !== expected) return [{ kind: "tag-mismatch", tag, expected }];
  return [];
}
