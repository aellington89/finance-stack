// Pure version/changelog/tag consistency checks backing the changelog CI gate
// (app/scripts/check-changelog.ts). Side-effect-free — no I/O, no process.exit —
// so the unit suite exercises every branch against inline fixtures. Mirrors
// seed-reference-check.ts. See Issue #173 and docs/releases.md.

import type { ChangelogRelease } from "@/lib/changelog";

export const VERSION_RE = /^\d+\.\d+\.\d+$/; // X.Y.Z  (package.json / changelog)
export const RELEASE_TAG_RE = /^v\d+\.\d+\.\d+$/; // vX.Y.Z (docs/releases.md, #167)

export type ChangelogProblem =
  | { kind: "no-releases"; pkgVersion: string }
  | { kind: "version-mismatch"; pkgVersion: string; changelogVersion: string }
  | { kind: "tag-format"; tag: string }
  | { kind: "tag-mismatch"; tag: string; expected: string };

// First heading whose version is X.Y.Z — skips [Unreleased] / non-semver. null if none.
export function newestReleaseVersion(releases: ChangelogRelease[]): string | null {
  for (const r of releases) if (VERSION_RE.test(r.version)) return r.version;
  return null;
}

export function checkChangelog(
  pkgVersion: string,
  releases: ChangelogRelease[],
): ChangelogProblem[] {
  const newest = newestReleaseVersion(releases);
  if (newest === null) return [{ kind: "no-releases", pkgVersion }];
  if (newest !== pkgVersion) return [{ kind: "version-mismatch", pkgVersion, changelogVersion: newest }];
  return [];
}

// Combined with checkChangelog, enforces tag === v<version> === CHANGELOG top.
export function checkTag(tag: string, pkgVersion: string): ChangelogProblem[] {
  if (!RELEASE_TAG_RE.test(tag)) return [{ kind: "tag-format", tag }];
  const expected = `v${pkgVersion}`;
  if (tag !== expected) return [{ kind: "tag-mismatch", tag, expected }];
  return [];
}
