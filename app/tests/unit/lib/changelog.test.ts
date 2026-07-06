import { describe, expect, it } from "vitest";
import { parseChangelog, parseInline } from "@/lib/changelog";

// Representative CHANGELOG.md fragment matching the repo's Keep-a-Changelog format.
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

### Added

- Liabilities drill-down page at \`/dashboard/liabilities\` ([Issue #112](https://github.com/example/repo/issues/112)).

### Fixed

- Date Range filter UX fix ([Issue #61](https://github.com/example/repo/issues/61)).

## [0.1.0] - 2026-03-29

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
