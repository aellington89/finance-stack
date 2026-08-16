import { describe, expect, it } from "vitest";

import { parseChangelog } from "@/lib/changelog";
import {
  checkChangelog,
  checkMigrationMarkers,
  checkTag,
  newestRelease,
  newestReleaseVersion,
} from "@/scripts/check-changelog-core";

// Representative CHANGELOG.md fragment with both Unreleased and released entries.
// Released sections carry a **Migration:** marker; [Unreleased] deliberately does
// not, mirroring the real file — that section is exempt (Issue #277).
const SAMPLE = `\
## [Unreleased]

### Added

- Some unreleased change.

## [0.1.3] - 2026-05-17

**Migration:** backward-compatible

### Added

- Liabilities drill-down page.

## [0.1.0] - 2026-03-29

**Migration:** none

### Added

- Initial release.

---

[Unreleased]: https://github.com/example/repo/compare/v0.1.3...HEAD
`;

const UNRELEASED_ONLY = `\
## [Unreleased]

### Added

- Work in progress.
`;

describe("newestReleaseVersion", () => {
  it("skips [Unreleased] and returns the first versioned release", () => {
    expect(newestReleaseVersion(parseChangelog(SAMPLE))).toBe("0.1.3");
  });

  it("returns null when there are no versioned releases", () => {
    expect(newestReleaseVersion(parseChangelog(UNRELEASED_ONLY))).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(newestReleaseVersion([])).toBeNull();
  });
});

describe("newestRelease", () => {
  it("returns the release object, not just its version", () => {
    const release = newestRelease(parseChangelog(SAMPLE));
    expect(release).toMatchObject({
      version: "0.1.3",
      date: "2026-05-17",
      migration: "backward-compatible",
    });
  });

  it("skips [Unreleased] the same way newestReleaseVersion does", () => {
    expect(newestRelease(parseChangelog(UNRELEASED_ONLY))).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(newestRelease([])).toBeNull();
  });
});

describe("checkChangelog", () => {
  it("returns [] when package.json version matches the newest release", () => {
    expect(checkChangelog("0.1.3", parseChangelog(SAMPLE))).toEqual([]);
  });

  it("returns version-mismatch when package.json is ahead of changelog", () => {
    const problems = checkChangelog("0.1.4", parseChangelog(SAMPLE));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: "version-mismatch",
      pkgVersion: "0.1.4",
      changelogVersion: "0.1.3",
    });
  });

  it("returns version-mismatch when package.json is behind changelog", () => {
    const problems = checkChangelog("0.1.2", parseChangelog(SAMPLE));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: "version-mismatch",
      pkgVersion: "0.1.2",
      changelogVersion: "0.1.3",
    });
  });

  it("returns no-releases when only [Unreleased] exists", () => {
    const problems = checkChangelog("0.1.4", parseChangelog(UNRELEASED_ONLY));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "no-releases", pkgVersion: "0.1.4" });
  });

  it("returns no-releases for an empty releases array", () => {
    const problems = checkChangelog("0.1.0", []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "no-releases" });
  });

  it("returns missing-migration-marker when the version agrees but no marker is declared", () => {
    const md = `## [0.1.3] - 2026-05-17\n\n### Added\n\n- Something.\n`;
    const problems = checkChangelog("0.1.3", parseChangelog(md));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "missing-migration-marker", version: "0.1.3" });
  });

  it("suppresses marker problems while the version still mismatches", () => {
    const md = `## [0.1.3] - 2026-05-17\n\n**Migration:** sideways\n`;
    const problems = checkChangelog("0.1.4", parseChangelog(md));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "version-mismatch" });
  });
});

// Issue #277. A marker is *required* only on the release being tagged, but a
// value that is present and unrecognized is rejected wherever it appears —
// [Unreleased] included — so a typo fails on the branch that introduced it
// rather than resurfacing as a missing marker when that section is closed.
describe("checkMigrationMarkers", () => {
  it("returns [] when the newest release declares a legal kind", () => {
    expect(checkMigrationMarkers(parseChangelog(SAMPLE))).toEqual([]);
  });

  it("accepts each of the three legal kinds", () => {
    for (const kind of ["none", "backward-compatible", "breaking"]) {
      const md = `## [0.1.0] - 2026-01-01\n\n**Migration:** ${kind}\n`;
      expect(checkMigrationMarkers(parseChangelog(md))).toEqual([]);
    }
  });

  it("returns missing-migration-marker when the newest release has none", () => {
    const md = `## [0.1.0] - 2026-01-01\n\n### Added\n\n- Something.\n`;
    const problems = checkMigrationMarkers(parseChangelog(md));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "missing-migration-marker", version: "0.1.0" });
  });

  it("returns bad-migration-marker carrying the value it rejected", () => {
    const md = `## [0.1.0] - 2026-01-01\n\n**Migration:** sideways\n`;
    const problems = checkMigrationMarkers(parseChangelog(md));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: "bad-migration-marker",
      version: "0.1.0",
      value: "sideways",
    });
  });

  it("reports an empty marker value as malformed rather than missing", () => {
    const md = `## [0.1.0] - 2026-01-01\n\n**Migration:**\n`;
    const problems = checkMigrationMarkers(parseChangelog(md));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: "bad-migration-marker",
      version: "0.1.0",
      value: "",
    });
  });

  it("exempts [Unreleased] from the required-marker rule", () => {
    const md = `## [Unreleased]\n\n### Added\n\n- WIP.\n\n## [0.1.0] - 2026-01-01\n\n**Migration:** none\n`;
    expect(checkMigrationMarkers(parseChangelog(md))).toEqual([]);
  });

  it("still rejects a malformed marker on [Unreleased]", () => {
    const md = `## [Unreleased]\n\n**Migration:** oops\n\n## [0.1.0] - 2026-01-01\n\n**Migration:** none\n`;
    const problems = checkMigrationMarkers(parseChangelog(md));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: "bad-migration-marker",
      version: "Unreleased",
      value: "oops",
    });
  });

  it("rejects a malformed marker on an older, already-released section", () => {
    const md = `## [0.2.0] - 2026-02-02\n\n**Migration:** none\n\n## [0.1.0] - 2026-01-01\n\n**Migration:** nonsense\n`;
    const problems = checkMigrationMarkers(parseChangelog(md));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: "bad-migration-marker",
      version: "0.1.0",
      value: "nonsense",
    });
  });

  it("does not require a marker when there is no released section at all", () => {
    expect(checkMigrationMarkers(parseChangelog(UNRELEASED_ONLY))).toEqual([]);
  });

  it("returns [] for an empty releases array", () => {
    expect(checkMigrationMarkers([])).toEqual([]);
  });
});

describe("checkTag", () => {
  it("returns [] for a valid tag matching the package version", () => {
    expect(checkTag("v0.1.3", "0.1.3")).toEqual([]);
  });

  it("returns tag-format for v.0.1.3 (stray dot — the #167 incident)", () => {
    const problems = checkTag("v.0.1.3", "0.1.3");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "tag-format", tag: "v.0.1.3" });
  });

  it("returns tag-format for v0.1.3.1 (extra component)", () => {
    const problems = checkTag("v0.1.3.1", "0.1.3");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "tag-format", tag: "v0.1.3.1" });
  });

  it("returns tag-format for 0.1.3 (missing v prefix)", () => {
    const problems = checkTag("0.1.3", "0.1.3");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "tag-format", tag: "0.1.3" });
  });

  it("returns tag-format for v0.1.0-alpha.5 (pre-release not yet gate-enforced)", () => {
    const problems = checkTag("v0.1.0-alpha.5", "0.1.0");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "tag-format", tag: "v0.1.0-alpha.5" });
  });

  it("returns tag-mismatch for a well-formed tag that doesn't match pkgVersion", () => {
    const problems = checkTag("v0.1.4", "0.1.3");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "tag-mismatch", tag: "v0.1.4", expected: "v0.1.3" });
  });
});
