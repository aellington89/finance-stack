// I/O wrapper for the release-notes generator. Reads git log, fetches GitHub
// issue labels via `gh`, and delegates all logic to the pure core module so
// the core stays unit-testable. See Issue #170.
//
// Usage: tsx scripts/release-notes.ts <git-range> [--changelog|--release]
// Example: npm run release:notes -- v0.1.3..HEAD --changelog

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatChangelog,
  formatRelease,
  groupCommits,
  parseCommits,
  suggestBump,
} from "@/scripts/release-notes-core";

function usage(): never {
  console.error(
    "Usage: tsx scripts/release-notes.ts <git-range> [--changelog|--release]\n" +
      "  Example: npm run release:notes -- v0.1.3..HEAD --changelog\n" +
      "  Default output mode: --changelog",
  );
  process.exit(1);
}

function readRepoSlug(): string {
  try {
    const remoteUrl = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    // SSH:   git@github.com:owner/repo.git
    // HTTPS: https://github.com/owner/repo.git
    const match =
      /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl);
    return match ? match[1] : "owner/repo";
  } catch {
    return "owner/repo";
  }
}

function fetchLabels(
  issueNumbers: number[],
  repoSlug: string,
): Map<number, string[]> {
  const map = new Map<number, string[]>();
  const [owner, repo] = repoSlug.split("/");

  for (const n of issueNumbers) {
    try {
      const raw = execSync(
        `gh api repos/${owner}/${repo}/issues/${n} --jq '[.labels[].name]'`,
        { encoding: "utf8" },
      ).trim();
      map.set(n, JSON.parse(raw) as string[]);
    } catch {
      console.warn(`Warning: could not fetch labels for issue #${n} — skipping`);
    }
  }

  return map;
}

function readCurrentVersion(): string {
  const pkgPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../package.json",
  );
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

function main(): void {
  const args = process.argv.slice(2);
  const range = args.find((a) => !a.startsWith("--"));
  const mode = args.includes("--release") ? "release" : "changelog";

  if (!range) usage();

  let gitLog: string;
  try {
    gitLog = execSync(`git log --oneline ${range}`, { encoding: "utf8" });
  } catch (err) {
    console.error(`Error running git log for range "${range}": ${String(err)}`);
    process.exit(1);
  }

  const commits = parseCommits(gitLog);
  const { issues, other } = groupCommits(commits);

  const issueNumbers = issues.map((e) => e.issueNumber);
  const repoSlug = readRepoSlug();
  const labelsByIssue = fetchLabels(issueNumbers, repoSlug);
  const currentVersion = readCurrentVersion();
  const { nextVersion, bump } = suggestBump(currentVersion, labelsByIssue);
  const today = new Date().toISOString().slice(0, 10);

  const output =
    mode === "release"
      ? formatRelease(issues, other, nextVersion, bump, repoSlug)
      : formatChangelog(issues, other, nextVersion, bump, repoSlug, today);

  console.log(output);
}

main();
