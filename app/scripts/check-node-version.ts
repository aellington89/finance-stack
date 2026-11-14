// CI gate (and `npm run check:node-version`): asserts that the three places the
// Node runtime is declared agree.
//
//   - every `FROM node:<major>-alpine...` stage in app/Dockerfile;
//   - every `node-version:` pin under .github/workflows/;
//   - the `@types/node` range in app/package.json (exactly `^<major>`).
//
// Issues #210 and #245 are the two times these drifted. Dependabot's `docker`
// ecosystem reads Dockerfiles only and its npm ecosystem reads package.json, so
// a PR from either can move one surface alone and leave CI testing a different
// runtime than the image ships, or tsc checking against APIs the runtime does
// not have. Review caught both; this makes the next one fail in CI, naming the
// file and line that disagree.
//
// Run locally with: npm run check:node-version
// A positional argument overrides the repo root, which is what the tests use.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findNodeVersionProblems,
  type NodeVersionProblem,
  type VersionSurface,
} from "@/scripts/node-version-check";

// This file lives at app/scripts/, so ../../ is the repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rootArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const ROOT = rootArg === undefined ? REPO_ROOT : resolve(rootArg);

function read(relPath: string): VersionSurface {
  return { path: relPath, text: readFileSync(join(ROOT, relPath), "utf8") };
}

function workflowSurfaces(): VersionSurface[] {
  const dir = join(ROOT, ".github/workflows");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => read(join(".github/workflows", name)));
}

function formatProblem(p: NodeVersionProblem): string {
  switch (p.kind) {
    case "no-dockerfile-pin":
      return (
        `::error::Node version gate: ${p.path} has no "FROM node:<major>" stage, so the ` +
        `image's runtime cannot be compared with CI or @types/node. Restore the node base ` +
        `image, or update app/scripts/check-node-version.ts if the Dockerfile moved.`
      );
    case "dockerfile-unparseable":
      return (
        `::error::Node version drift: ${p.path}:${p.line} uses the node image tag "${p.value}", ` +
        `which does not start with a Node major. Use a literal tag such as node:24-alpine.`
      );
    case "dockerfile-mismatch":
      return (
        `::error::Node version drift: ${p.path}:${p.line} declares Node ${p.declared}, but the ` +
        `image otherwise ships Node ${p.expected}. Every FROM node stage must name the same major.`
      );
    case "workflow-unparseable":
      return (
        `::error::Node version drift: ${p.path}:${p.line} sets node-version to "${p.value}", ` +
        `which is not a literal Node major. Pin it so the gate can compare it with the image.`
      );
    case "workflow-mismatch":
      return (
        `::error::Node version drift: ${p.path}:${p.line} pins Node ${p.declared}, but ` +
        `app/Dockerfile ships Node ${p.expected}. Move this pin with the image, or move the image back.`
      );
    case "types-missing":
      return (
        `::error::Node version gate: ${p.path} has no @types/node entry, so tsc is not checked ` +
        `against any Node major. Add "@types/node": "^<image major>" to devDependencies.`
      );
    case "types-mismatch":
      return (
        `::error::Node version drift: ${p.path}:${p.line} declares @types/node "${p.declared}", ` +
        `but the image ships Node ${p.expected}. Set it to "^${p.expected}" so tsc checks the ` +
        `runtime that ships.`
      );
  }
}

function main(): void {
  const problems = findNodeVersionProblems({
    dockerfile: read("app/Dockerfile"),
    workflows: workflowSurfaces(),
    packageJson: read("app/package.json"),
  });

  if (problems.length > 0) {
    for (const problem of problems) console.error(formatProblem(problem));
    console.error("");
    console.error(
      "app/Dockerfile, .github/workflows/*.yml and app/package.json's @types/node must all " +
        "name the same Node major (issue #442). Bump all three together — the checklists in " +
        ".github/dependabot.yml name the files. Re-run `npm run check:node-version`.",
    );
    process.exit(1);
  }

  console.log(
    "✓ Node version gate: app/Dockerfile, .github/workflows/ and @types/node agree on the " +
      "Node major the image ships",
  );
}

main();
