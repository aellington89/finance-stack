// CI gate (and `npm run check:changelog`): asserts package.json version matches the
// newest CHANGELOG.md released entry, and — when running on a git tag push — that
// the pushed tag is a well-formed vX.Y.Z equal to v<version>. Catches
// package.json/CHANGELOG/tag drift at build time (e.g. bumping package.json without
// closing the Unreleased section, or pushing a malformed tag like v.0.1.3). See
// docs/releases.md and Issue #173. Mirrors the Seed-reference gate's ::error::
// annotation + remediation-hint style.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseChangelog } from "@/lib/changelog";
import {
  checkChangelog,
  checkTag,
  type ChangelogProblem,
} from "@/scripts/check-changelog-core";

const HERE = dirname(fileURLToPath(import.meta.url));
// This file lives at app/scripts/, so ../../ is the repo root.
const CHANGELOG_PATH = resolve(HERE, "../../CHANGELOG.md");
const PKG_PATH = resolve(HERE, "../package.json");

function readPkgVersion(): string {
  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

// Explicit CLI positional arg wins (e.g. npm run check:changelog -- v0.1.4).
// Then fall back to GitHub Actions tag env vars. Undefined = branch push, skip tag check.
function resolveTag(): string | undefined {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (arg) return arg;
  if (process.env.GITHUB_REF_TYPE === "tag") return process.env.GITHUB_REF_NAME;
  return undefined;
}

function formatProblem(p: ChangelogProblem): string {
  switch (p.kind) {
    case "no-releases":
      return `::error::Changelog gate: no released version found in CHANGELOG.md — cannot compare against package.json version "${p.pkgVersion}"`;
    case "version-mismatch":
      return (
        `::error::Changelog drift: package.json version "${p.pkgVersion}" does not match ` +
        `the newest CHANGELOG.md release ("${p.changelogVersion}"). Close the [Unreleased] ` +
        `section as [${p.pkgVersion}] or revert package.json to "${p.changelogVersion}".`
      );
    case "tag-format":
      return (
        `::error::Tag consistency: "${p.tag}" is not a valid release tag — expected the ` +
        `shape vX.Y.Z (e.g. v0.1.3). See docs/releases.md.`
      );
    case "tag-mismatch":
      return (
        `::error::Tag consistency: pushed tag "${p.tag}" does not match package.json ` +
        `version (expected "${p.expected}"). Bump package.json and CHANGELOG.md to match, ` +
        `or push the correct tag.`
      );
  }
}

function main(): void {
  const pkgVersion = readPkgVersion();
  const releases = parseChangelog(readFileSync(CHANGELOG_PATH, "utf8"));
  const tag = resolveTag();

  const problems = checkChangelog(pkgVersion, releases);
  if (tag !== undefined) problems.push(...checkTag(tag, pkgVersion));

  if (problems.length === 0) {
    const tagNote = tag ? ` (tag: ${tag})` : "";
    console.log(`✓ Changelog gate: package.json "${pkgVersion}" matches CHANGELOG.md${tagNote}`);
    return;
  }

  for (const p of problems) console.error(formatProblem(p));
  console.error("");
  console.error(
    "version, changelog, and tag are out of sync. To release: rename [Unreleased] to " +
      "[X.Y.Z] - YYYY-MM-DD in CHANGELOG.md, bump package.json version to X.Y.Z, and " +
      "push an annotated tag vX.Y.Z. See docs/releases.md. Re-run `npm run check:changelog`.",
  );
  process.exit(1);
}

main();
