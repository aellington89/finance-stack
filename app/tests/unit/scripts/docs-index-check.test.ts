import { describe, expect, it } from "vitest";

import {
  findDocsIndexProblems,
  parseIndexSection,
  type DocsIndex,
} from "@/scripts/docs-index-check";

// Representative docs/README.md: a prose section that links out of docs/, then
// the Guides list whose links are bare filenames.
const DOCS_INDEX = `\
# Documentation

## Strategy

The root [README](../README.md) is the entry point. [\`CHANGELOG.md\`](../CHANGELOG.md)
and [\`CONTRIBUTING.md\`](../CONTRIBUTING.md) round out the set.

## Guides

- [Authentication](auth.md) — the auth model
- [Database](database.md) — schema and views
`;

// Representative root README.md: links into docs/ from prose as well as from
// the Documentation list, plus non-docs entries in the list itself.
const ROOT_INDEX = `\
# Finance Stack

## Security

See [docs/auth.md](docs/auth.md) for the full model.

## Documentation

- [Contributing](CONTRIBUTING.md) — dev workflow
- [Authentication](docs/auth.md) — the auth model
- [Database](docs/database.md) — schema and views
- [Changelog](CHANGELOG.md) — release history
`;

function indexes(docsMarkdown = DOCS_INDEX, rootMarkdown = ROOT_INDEX): DocsIndex[] {
  return [
    { path: "docs/README.md", heading: "Guides", linkPrefix: "", markdown: docsMarkdown },
    { path: "README.md", heading: "Documentation", linkPrefix: "docs/", markdown: rootMarkdown },
  ];
}

describe("parseIndexSection", () => {
  it("returns the hrefs under the named heading and nothing above it", () => {
    expect(parseIndexSection(DOCS_INDEX, "Guides")).toEqual(["auth.md", "database.md"]);
  });

  it("stops at the next heading", () => {
    const markdown = `\
## Guides

- [Authentication](auth.md) — the auth model

## Something Else

- [Not a guide](elsewhere.md)
`;
    expect(parseIndexSection(markdown, "Guides")).toEqual(["auth.md"]);
  });

  it("keeps a nested ### subsection inside the section", () => {
    const markdown = `\
## Guides

- [Authentication](auth.md)

### Operational

- [Backups](backups.md)

## Next
`;
    expect(parseIndexSection(markdown, "Guides")).toEqual(["auth.md", "backups.md"]);
  });

  it("returns null when the heading is absent", () => {
    expect(parseIndexSection(DOCS_INDEX, "Nope")).toBeNull();
  });
});

describe("findDocsIndexProblems", () => {
  it("reports nothing when both indexes list every guide", () => {
    expect(findDocsIndexProblems(["auth.md", "database.md"], indexes())).toEqual([]);
  });

  it("reports a guide missing from one index, naming that index", () => {
    const problems = findDocsIndexProblems(["auth.md", "database.md", "backups.md"], [
      // docs/README.md gains the entry; the root does not.
      {
        path: "docs/README.md",
        heading: "Guides",
        linkPrefix: "",
        markdown: `${DOCS_INDEX}- [Backups](backups.md) — the backup service\n`,
      },
      indexes()[1],
    ]);

    expect(problems).toEqual([
      { reason: "unlisted", index: "README.md", heading: "Documentation", doc: "backups.md" },
    ]);
  });

  it("reports a guide missing from both indexes once per index", () => {
    const problems = findDocsIndexProblems(["auth.md", "database.md", "backups.md"], indexes());

    expect(problems).toEqual([
      { reason: "unlisted", index: "docs/README.md", heading: "Guides", doc: "backups.md" },
      { reason: "unlisted", index: "README.md", heading: "Documentation", doc: "backups.md" },
    ]);
  });

  // The drift that motivates scoping the parse to the section. The root README
  // linked docs/secrets.md from its Security prose while omitting it from the
  // Documentation list for three releases; a whole-file search called that
  // indexed. It is not.
  it("does not count a link that sits outside the index section", () => {
    const rootMarkdown = `\
# Finance Stack

## Security

Credentials live in one file — see [docs/secrets.md](docs/secrets.md) for rotation.

## Documentation

- [Authentication](docs/auth.md) — the auth model
- [Database](docs/database.md) — schema and views
`;
    const problems = findDocsIndexProblems(
      ["auth.md", "database.md", "secrets.md"],
      [indexes()[0], { ...indexes()[1], markdown: rootMarkdown }],
    );

    expect(problems).toContainEqual({
      reason: "unlisted",
      index: "README.md",
      heading: "Documentation",
      doc: "secrets.md",
    });
  });

  it("reports an index link to a guide that does not exist", () => {
    const docsMarkdown = `${DOCS_INDEX}- [Gone](removed.md) — deleted in a refactor\n`;
    const problems = findDocsIndexProblems(
      ["auth.md", "database.md"],
      [{ ...indexes()[0], markdown: docsMarkdown }],
    );

    expect(problems).toEqual([
      { reason: "dead-link", index: "docs/README.md", heading: "Guides", doc: "removed.md" },
    ]);
  });

  it("ignores links in the section that do not point into docs/", () => {
    // The root list links CONTRIBUTING.md and CHANGELOG.md; neither is a guide
    // and neither is a dead link.
    const problems = findDocsIndexProblems(["auth.md", "database.md"], [indexes()[1]]);
    expect(problems).toEqual([]);
  });

  it("ignores an external URL in the section", () => {
    const docsMarkdown = `${DOCS_INDEX}- [Upstream](https://example.com/guide.md) — not ours\n`;
    const problems = findDocsIndexProblems(
      ["auth.md", "database.md"],
      [{ ...indexes()[0], markdown: docsMarkdown }],
    );
    expect(problems).toEqual([]);
  });

  it("treats a link carrying a fragment as a link to the file", () => {
    const rootMarkdown = ROOT_INDEX.replace(
      "[Database](docs/database.md)",
      "[Database](docs/database.md#roles--privileges)",
    );
    const problems = findDocsIndexProblems(
      ["auth.md", "database.md"],
      [{ ...indexes()[1], markdown: rootMarkdown }],
    );
    expect(problems).toEqual([]);
  });

  // A renamed heading must not quietly switch the gate off.
  it("fails closed when an index has no matching heading", () => {
    const problems = findDocsIndexProblems(
      ["auth.md", "database.md"],
      [{ ...indexes()[0], heading: "Documentation Guides" }],
    );

    expect(problems).toEqual([
      {
        reason: "missing-section",
        index: "docs/README.md",
        heading: "Documentation Guides",
        doc: null,
      },
    ]);
  });
});
