import { describe, expect, it } from "vitest";
import { isMigrationKind, parseChangelog, parseInline } from "@/lib/changelog";

// Representative CHANGELOG.md fragment matching the repo's Keep-a-Changelog format.
// [Unreleased] deliberately carries no **Migration:** marker — that section is
// exempt (Issue #277), and the real CHANGELOG.md looks the same way.
const SAMPLE = `\
# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Migrated operational reference content from the README ([Issue #168](https://github.com/example/repo/issues/168)).
- CI seed-reference gate (\`npm run check:seed-references\`) ([Issue #155](https://github.com/example/repo/issues/155)).

### Changed

- Extracted \`amountColorClass\` and shared SQL helpers ([Issue #134](https://github.com/example/repo/issues/134)).

## [0.1.3] - 2026-05-17

**Migration:** backward-compatible

### Added

- Liabilities drill-down page at \`/dashboard/liabilities\` ([Issue #112](https://github.com/example/repo/issues/112)).

### Fixed

- Date Range filter UX fix ([Issue #61](https://github.com/example/repo/issues/61)).

## [0.1.0] - 2026-03-29

**Migration:** none

### Added

- Unified sidebar navigation ([Issue #77](https://github.com/example/repo/issues/77)).

---

[Unreleased]: https://github.com/example/repo/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/example/repo/compare/v0.1.2...v0.1.3
`;

describe("parseChangelog", () => {
  it("returns the correct number of releases", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases).toHaveLength(3);
  });

  it("returns releases in file order (newest-first)", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases[0].version).toBe("Unreleased");
    expect(releases[1].version).toBe("0.1.3");
    expect(releases[2].version).toBe("0.1.0");
  });

  it("parses [Unreleased] with date: null", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases[0].date).toBeNull();
  });

  it("parses versioned releases with the correct date", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases[1].version).toBe("0.1.3");
    expect(releases[1].date).toBe("2026-05-17");
  });

  it("groups items under their section headings", () => {
    const releases = parseChangelog(SAMPLE);
    const unreleased = releases[0];
    const headings = unreleased.sections.map((s) => s.heading);
    expect(headings).toEqual(["Added", "Changed"]);
  });

  it("preserves all bullet items per section", () => {
    const releases = parseChangelog(SAMPLE);
    const addedSection = releases[0].sections.find((s) => s.heading === "Added");
    expect(addedSection?.items).toHaveLength(2);
  });

  it("preserves raw bullet text including link markup", () => {
    const releases = parseChangelog(SAMPLE);
    const addedSection = releases[0].sections.find((s) => s.heading === "Added");
    expect(addedSection?.items[0].raw).toContain("Issue #168");
  });

  it("stops at the --- footer line", () => {
    const releases = parseChangelog(SAMPLE);
    // No release after [0.1.0]; the reference-link block is excluded
    expect(releases).toHaveLength(3);
    expect(releases[2].version).toBe("0.1.0");
  });

  it("returns [] for empty string", () => {
    expect(parseChangelog("")).toEqual([]);
  });

  it("returns [] for a string with only a file header and no release headings", () => {
    const headerOnly = "# Changelog\n\nAll notable changes.\n";
    expect(parseChangelog(headerOnly)).toEqual([]);
  });

  it("ignores content before the first release heading", () => {
    const releases = parseChangelog(SAMPLE);
    // First release is Unreleased — preamble lines are not in any release
    expect(releases[0].version).toBe("Unreleased");
  });

  it("handles releases with no sections", () => {
    const minimal = "## [0.1.0] - 2026-01-01\n";
    const releases = parseChangelog(minimal);
    expect(releases).toHaveLength(1);
    expect(releases[0].sections).toEqual([]);
  });

  it("stops at a reference-link line instead of ---", () => {
    const withRef = `\
## [0.1.0] - 2026-01-01

### Added

- Some feature.

[0.1.0]: https://github.com/example/repo/releases/tag/v0.1.0
`;
    const releases = parseChangelog(withRef);
    expect(releases).toHaveLength(1);
    expect(releases[0].sections[0].items).toHaveLength(1);
  });
});

// Issue #277. The marker is the one line shape the parser captures outside a
// section, so its boundaries — where it may appear, and what an unrecognized
// value becomes — are the whole contract the gate rests on.
describe("parseChangelog — Migration marker", () => {
  it("captures a recognized marker into both migration and migrationRaw", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases[1].version).toBe("0.1.3");
    expect(releases[1].migration).toBe("backward-compatible");
    expect(releases[1].migrationRaw).toBe("backward-compatible");
  });

  it("parses all three legal kinds", () => {
    const all = `\
## [0.3.0] - 2026-03-03

**Migration:** breaking

## [0.2.0] - 2026-02-02

**Migration:** backward-compatible

## [0.1.0] - 2026-01-01

**Migration:** none
`;
    expect(parseChangelog(all).map((r) => r.migration)).toEqual([
      "breaking",
      "backward-compatible",
      "none",
    ]);
  });

  it("yields null for both fields when a release carries no marker", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases[0].version).toBe("Unreleased");
    expect(releases[0].migration).toBeNull();
    expect(releases[0].migrationRaw).toBeNull();
  });

  it("keeps an unrecognized value in migrationRaw without coercing migration", () => {
    const releases = parseChangelog("## [0.1.0] - 2026-01-01\n\n**Migration:** frobnicate\n");
    expect(releases[0].migration).toBeNull();
    expect(releases[0].migrationRaw).toBe("frobnicate");
  });

  it("treats a wrong-case value as malformed rather than a synonym", () => {
    const releases = parseChangelog("## [0.1.0] - 2026-01-01\n\n**Migration:** Breaking\n");
    expect(releases[0].migration).toBeNull();
    expect(releases[0].migrationRaw).toBe("Breaking");
  });

  it("treats an empty value as present-but-malformed, not missing", () => {
    const releases = parseChangelog("## [0.1.0] - 2026-01-01\n\n**Migration:**\n");
    expect(releases[0].migration).toBeNull();
    expect(releases[0].migrationRaw).toBe("");
  });

  it("ignores a marker that appears after the first ### section", () => {
    const late = `\
## [0.1.0] - 2026-01-01

### Added

**Migration:** breaking

- Something.
`;
    const releases = parseChangelog(late);
    expect(releases[0].migration).toBeNull();
    expect(releases[0].migrationRaw).toBeNull();
  });

  it("ignores a marker before the first release heading", () => {
    const preamble = `\
# Changelog

**Migration:** breaking

## [0.1.0] - 2026-01-01

**Migration:** none
`;
    const releases = parseChangelog(preamble);
    expect(releases).toHaveLength(1);
    expect(releases[0].migration).toBe("none");
  });

  it("keeps the first marker when a release carries two", () => {
    const dup = `\
## [0.1.0] - 2026-01-01

**Migration:** none

**Migration:** breaking
`;
    expect(parseChangelog(dup)[0].migration).toBe("none");
  });

  it("does not leak a marker into the following release", () => {
    const mixed = `\
## [0.2.0] - 2026-02-02

**Migration:** breaking

### Added

- Something.

## [0.1.0] - 2026-01-01

### Added

- Something else.
`;
    const releases = parseChangelog(mixed);
    expect(releases[0].migration).toBe("breaking");
    expect(releases[1].migration).toBeNull();
    expect(releases[1].migrationRaw).toBeNull();
  });

  it("does not capture the marker line as a bullet item", () => {
    const releases = parseChangelog(SAMPLE);
    const added = releases[1].sections.find((s) => s.heading === "Added");
    expect(added?.items).toHaveLength(1);
  });
});

describe("isMigrationKind", () => {
  it("accepts the three legal kinds", () => {
    expect(isMigrationKind("none")).toBe(true);
    expect(isMigrationKind("backward-compatible")).toBe(true);
    expect(isMigrationKind("breaking")).toBe(true);
  });

  it("rejects anything else, including wrong case and empty", () => {
    expect(isMigrationKind("Breaking")).toBe(false);
    expect(isMigrationKind("backwards-compatible")).toBe(false);
    expect(isMigrationKind("")).toBe(false);
  });
});

describe("parseInline", () => {
  it("returns a single text token for plain text", () => {
    const tokens = parseInline("just plain text");
    expect(tokens).toEqual([{ type: "text", value: "just plain text" }]);
  });

  it("parses a single markdown link", () => {
    const tokens = parseInline("[Issue #42](https://github.com/example/repo/issues/42)");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({
      type: "link",
      label: "Issue #42",
      href: "https://github.com/example/repo/issues/42",
    });
  });

  it("parses a link surrounded by text", () => {
    const tokens = parseInline("See ([Issue #42](https://github.com/example/repo/issues/42)).");
    expect(tokens.some((t) => t.type === "link")).toBe(true);
    expect(tokens.some((t) => t.type === "text" && t.value.includes("See"))).toBe(true);
  });

  it("parses multiple links in one line", () => {
    const tokens = parseInline(
      "[Issue #1](https://github.com/x/y/issues/1) and [Issue #2](https://github.com/x/y/issues/2)"
    );
    const links = tokens.filter((t) => t.type === "link");
    expect(links).toHaveLength(2);
  });

  it("parses a code span", () => {
    const tokens = parseInline("run `npm run build` to compile");
    const codeToken = tokens.find((t) => t.type === "code");
    expect(codeToken).toEqual({ type: "code", value: "npm run build" });
  });

  it("parses mixed text, link, and code in one line", () => {
    const tokens = parseInline(
      "Added `amountColorClass` ([Issue #134](https://github.com/x/y/issues/134))."
    );
    const types = tokens.map((t) => t.type);
    expect(types).toContain("code");
    expect(types).toContain("link");
    expect(types).toContain("text");
  });

  it("returns [] for empty string", () => {
    expect(parseInline("")).toEqual([]);
  });

  it("passes through text with no markdown syntax unchanged", () => {
    const text = "Standardized the dashboard layout so every page shares one contract.";
    const tokens = parseInline(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ type: "text", value: text });
  });
});
