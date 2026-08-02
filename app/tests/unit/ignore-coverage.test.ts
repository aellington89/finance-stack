import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Encodes the acceptance criterion of Issue #181 — "`.gitignore` and
 * `.dockerignore` cover every `.env*` variant" — as a CI gate.
 *
 * The audit found the root `.gitignore` listing exactly `.env` and
 * `app/.env.local`, so `.env.production`, `.env.local` and `.env.bak` at the
 * root were all stageable by a plain `git add .`. That is a one-line mistake to
 * make again the next time someone reorganizes the file, and nothing else
 * catches it: gitleaks scans what was *committed*, which is one step too late.
 *
 * The negative cases matter as much as the positive ones. Writing `.env*`
 * without `!.env.example` ignores the templates a new user is told to copy in
 * the README, and the failure is silent — the files are already tracked, so
 * nothing breaks until someone clones fresh.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * `git check-ignore` is the authority here rather than reading the file and
 * reimplementing pattern matching — precedence between the root and `app/`
 * ignore files is exactly the part worth testing, and only git knows it.
 * Exit 0 = ignored, 1 = not ignored, anything else = git itself failed.
 *
 * `--no-index` is load-bearing, not tidiness. Ignore rules do not apply to
 * tracked paths, so without it git answers "not ignored" for `.env.example`
 * however the rules are written, and the template assertions below can never
 * fail. With it, the question becomes what the rules actually say.
 */
function isGitIgnored(path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", path], {
    cwd: repoRoot,
  });

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `git check-ignore failed for ${path}: ${result.stderr?.toString() ?? result.error}`
    );
  }

  return result.status === 0;
}

function dockerignorePatterns(file: string): string[] {
  return readFileSync(resolve(repoRoot, file), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

// Variants that a real leak has plausibly arrived as: the file this stack
// reads, the ones Next.js reads, and the ones an editor or a shell redirect
// leaves behind.
const MUST_BE_IGNORED = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.prod",
  ".env.development",
  ".env.bak",
  ".env.save",
  ".env.orig",
  "app/.env",
  "app/.env.local",
  "app/.env.production",
  "importer/.env",
];

// The committed templates. `git add`-able on purpose — the README tells a new
// user to copy them.
const MUST_NOT_BE_IGNORED = [".env.example", "app/.env.local.example"];

describe("credential files are ignored by git", () => {
  it.each(MUST_BE_IGNORED)("ignores %s", (path) => {
    expect(isGitIgnored(path)).toBe(true);
  });

  it.each(MUST_NOT_BE_IGNORED)("does not ignore the template %s", (path) => {
    expect(isGitIgnored(path)).toBe(false);
  });
});

describe("credential files are excluded from the Docker build contexts", () => {
  /**
   * `app/.dockerignore` is the one that governs the shipped image:
   * docker-compose.yml sets the finance-app build context to ./app. The runner
   * stage reads as though it were safe — it copies `.next/standalone` and not
   * the source tree — but `next build` copies every `.env*` file it finds into
   * `.next/standalone`, so a `.env` in the build context lands in the finished
   * image verbatim. Measured under the pre-#181 rules (`.env.local`,
   * `.env*.local`): a planted `app/.env.production` shipped at
   * `/app/.env.production` with its contents intact.
   *
   * Asserted against the pattern list rather than by running a build, so it
   * costs nothing on every push. docs/secrets.md carries the canary-build
   * recipe for checking the image itself.
   */
  it("app/.dockerignore excludes every .env variant with no exception", () => {
    const patterns = dockerignorePatterns("app/.dockerignore");

    expect(patterns).toContain(".env*");
    expect(patterns.filter((p) => p.startsWith("!") && p.includes(".env"))).toEqual([]);
  });

  it("the root .dockerignore excludes .env at any depth", () => {
    expect(dockerignorePatterns(".dockerignore")).toContain("**/.env*");
  });
});
