import { describe, expect, it } from "vitest";

import { parseChangelog } from "@/lib/changelog";
import {
  checkChangelog,
  checkTag,
  newestReleaseVersion,
} from "@/scripts/check-changelog-core";

// Representative CHANGELOG.md fragment with both Unreleased and released entries.
const SAMPLE = `\
## [Unreleased]

### Added

- Some unreleased change.

## [0.1.3] - 2026-05-17

### Added

- Liabilities drill-down page.

## [0.1.0] - 2026-03-29

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
