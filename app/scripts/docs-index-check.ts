// Pure parse + diff helpers backing the docs-index CI gate
// (app/scripts/check-docs.ts). Kept side-effect-free so the unit suite can
// exercise the logic against inline markdown fixtures without touching the
// filesystem or the process exit code.
//
// Two index lists cover one directory — the "## Guides" list in docs/README.md
// and the "## Documentation" list in the root README.md — and both are
// hand-maintained. Issue #186 was filed because two guides had been added to
// docs/ without being added to either; by the time it was picked up, a later
// commit had incidentally fixed docs/README.md and the root README had drifted
// three guides behind instead. The list agreeing with the directory is
// therefore asserted rather than remembered.
//
// The gate has two halves:
//
//   1. Completeness (unlisted) — every docs/*.md is linked from every index.
//      This is the issue.
//   2. Resolvability (dead-link) — every link in an index that points into
//      docs/ names a file that exists. The other direction of the same drift:
//      a renamed or deleted guide leaves a link behind.
//
// A missing heading is its own failure rather than a silent pass, because a
// renamed section would otherwise switch the gate off.

export type DocsIndexProblemReason = "unlisted" | "dead-link" | "missing-section";

export interface DocsIndexProblem {
  reason: DocsIndexProblemReason;
  // Repo-relative path of the index the problem is in, e.g. "docs/README.md".
  index: string;
  // The heading whose list was parsed, e.g. "Guides".
  heading: string;
  // The doc filename involved, e.g. "backups.md". Null for "missing-section",
  // which is about the index as a whole.
  doc: string | null;
}

export interface DocsIndex {
  // Repo-relative path. Used only in messages.
  path: string;
  // Text of the `## <heading>` whose bullet list is the index.
  heading: string;
  // Prefix the index's links carry: "" from inside docs/, "docs/" from the
  // repo root. Links that do not start with it are not this gate's business
  // (the root list also links CONTRIBUTING.md and CHANGELOG.md).
  linkPrefix: string;
  markdown: string;
}

// Return every markdown link href under the given `## <heading>`, or null if
// the heading is absent.
//
// Scoped to the section rather than the whole file, which is the point: the
// root README links docs/secrets.md in prose while omitting it from the
// Documentation list, so a whole-file search reports a guide as indexed when
// nothing indexes it. The section runs to the next `#` or `##` heading, so a
// `###` subsection inside it still counts as part of the list.
export function parseIndexSection(markdown: string, heading: string): string[] | null {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##?\s/.test(line));
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n");

  return [...section.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

// Resolve a link href to the docs/ filename it names, or null if it names
// something else. Fragments and query strings are stripped, so
// `docs/database.md#roles--privileges` counts as a link to database.md. A
// remainder containing a slash is a path out of docs/ (`../CHANGELOG.md`, an
// http URL, a nested file) and is not this gate's business.
function toDocFilename(href: string, linkPrefix: string): string | null {
  if (!href.startsWith(linkPrefix)) return null;

  const target = href.slice(linkPrefix.length).split(/[#?]/)[0];
  if (target.includes("/") || !target.endsWith(".md")) return null;

  return target;
}

// Cross-check the docs/ directory listing against each index, both directions.
// Returns one problem per divergence, grouped by index in the order given;
// an empty array means every index agrees with the directory.
export function findDocsIndexProblems(
  docFilenames: readonly string[],
  indexes: readonly DocsIndex[],
): DocsIndexProblem[] {
  const problems: DocsIndexProblem[] = [];
  const onDisk = new Set(docFilenames);

  for (const index of indexes) {
    const hrefs = parseIndexSection(index.markdown, index.heading);

    if (hrefs === null) {
      problems.push({
        reason: "missing-section",
        index: index.path,
        heading: index.heading,
        doc: null,
      });
      continue;
    }

    const listed = new Set(
      hrefs
        .map((href) => toDocFilename(href, index.linkPrefix))
        .filter((name): name is string => name !== null),
    );

    for (const doc of [...onDisk].sort()) {
      if (!listed.has(doc)) {
        problems.push({ reason: "unlisted", index: index.path, heading: index.heading, doc });
      }
    }

    for (const doc of [...listed].sort()) {
      if (!onDisk.has(doc)) {
        problems.push({ reason: "dead-link", index: index.path, heading: index.heading, doc });
      }
    }
  }

  return problems;
}
