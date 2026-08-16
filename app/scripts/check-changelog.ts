// CI gate (and `npm run check:changelog`): asserts package.json version matches the
// newest CHANGELOG.md released entry, that that release declares its migration
// impact, and — when running on a git tag push — that the pushed tag is a
// well-formed vX.Y.Z equal to v<version>. Catches package.json/CHANGELOG/tag drift
// at build time (e.g. bumping package.json without closing the Unreleased section,
// or pushing a malformed tag like v.0.1.3), plus a release that ships a schema
// change without saying whether it can be rolled back. See docs/releases.md and
// Issues #173 and #277. Mirrors the Seed-reference gate's ::error:: annotation +
// remediation-hint style.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MIGRATION_KINDS, parseChangelog } from "@/lib/changelog";
import {
  checkChangelog,
  checkTag,
  newestRelease,
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
    case "missing-migration-marker":
      return (
        `::error::Migration marker: release [${p.version}] does not declare its migration ` +
        `impact. Add a line directly under the "## [${p.version}]" heading, before the first ` +
        `### section:\n` +
        `    **Migration:** ${MIGRATION_KINDS.join(" | ")}\n` +
        `  none = no migration; backward-compatible = the previous app version runs fine ` +
        `against the new schema, so an image rollback suffices; breaking = rolling back ` +
        `requires restoring a pre-upgrade dump. See docs/releases.md.`
      );
    case "bad-migration-marker":
      return (
        `::error::Migration marker: release [${p.version}] declares "${p.value}", which is ` +
        `not a recognized value — expected one of ${MIGRATION_KINDS.join(", ")} ` +
        `(exact, lower-case). See docs/releases.md.`
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
    // Echo the declared impact: on a release run this is the operator's
    // confirmation of what they just committed to about rollback.
    const migrationNote = newestRelease(releases)?.migration ?? "unknown";
    console.log(
      `✓ Changelog gate: package.json "${pkgVersion}" matches CHANGELOG.md${tagNote} ` +
        `[migration: ${migrationNote}]`,
    );
    return;
  }

  for (const p of problems) console.error(formatProblem(p));
  console.error("");
  console.error(
    "CHANGELOG.md, package.json and the release tag must agree, and the release being " +
      "tagged must declare its migration impact. To release: rename [Unreleased] to " +
      "[X.Y.Z] - YYYY-MM-DD in CHANGELOG.md, add its **Migration:** marker, bump " +
      "package.json version to X.Y.Z, and push an annotated tag vX.Y.Z. See " +
      "docs/releases.md. Re-run `npm run check:changelog`.",
  );
  process.exit(1);
}

main();
