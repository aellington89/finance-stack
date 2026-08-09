// CI gate (and `npm run check:docs`): asserts that the two hand-maintained
// documentation indexes agree with the docs/ directory — every guide is linked
// from both, and neither links a guide that no longer exists.
//
// Issue #186. The indexes are the "## Guides" list in docs/README.md and the
// "## Documentation" list in the root README.md. Both had drifted behind the
// directory, at different times and by different guides, because nothing
// checked. See app/scripts/docs-index-check.ts for why the check is scoped to
// the list section rather than the whole file. Mirrors the Seed-reference
// gate's ::error:: annotation + remediation-hint style.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findDocsIndexProblems,
  type DocsIndex,
  type DocsIndexProblem,
} from "@/scripts/docs-index-check";

// This file lives at app/scripts/, so ../../ is the repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DOCS_DIR = join(REPO_ROOT, "docs");

// docs/README.md is the index, not a guide, so it is not expected to link
// itself.
const NOT_A_GUIDE = new Set(["README.md"]);

function readDocFilenames(): string[] {
  return readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith(".md") && !NOT_A_GUIDE.has(name))
    .sort();
}

function readIndexes(): DocsIndex[] {
  return [
    {
      path: "docs/README.md",
      heading: "Guides",
      linkPrefix: "",
      markdown: readFileSync(join(DOCS_DIR, "README.md"), "utf8"),
    },
    {
      path: "README.md",
      heading: "Documentation",
      linkPrefix: "docs/",
      markdown: readFileSync(join(REPO_ROOT, "README.md"), "utf8"),
    },
  ];
}

function formatProblem(p: DocsIndexProblem): string {
  switch (p.reason) {
    case "unlisted":
      return (
        `::error::Docs index drift: docs/${p.doc} exists but is not linked from the ` +
        `"## ${p.heading}" list in ${p.index}`
      );
    case "dead-link":
      return (
        `::error::Docs index drift: the "## ${p.heading}" list in ${p.index} links ` +
        `docs/${p.doc}, which does not exist`
      );
    case "missing-section":
      return (
        `::error::Docs index gate: ${p.index} has no "## ${p.heading}" heading, so the ` +
        `gate cannot find the list it checks. Restore the heading or update the index ` +
        `definition in app/scripts/check-docs.ts.`
      );
  }
}

function main(): void {
  const docs = readDocFilenames();
  const indexes = readIndexes();
  const problems = findDocsIndexProblems(docs, indexes);

  if (problems.length > 0) {
    for (const p of problems) console.error(formatProblem(p));
    console.error("");
    console.error(
      "every guide in docs/ is listed in two places — the \"## Guides\" list in " +
        "docs/README.md and the \"## Documentation\" list in README.md — and both must " +
        "name all of them (issue #186). Add or remove the entries above, following the " +
        "existing `- [Title](path) — description` format, then re-run `npm run check:docs`.",
    );
    process.exit(1);
  }

  console.log(
    `✓ Docs index gate: all ${docs.length} guides in docs/ are linked from ` +
      `${indexes.map((i) => i.path).join(" and ")}`,
  );
}

main();
