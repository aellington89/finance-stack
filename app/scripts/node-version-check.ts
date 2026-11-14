// Pure parsing and comparison backing the Node-version CI gate
// (app/scripts/check-node-version.ts). Side-effect-free — no I/O, no
// process.exit — so the unit suite exercises every branch against inline
// fixtures.
//
// The Node runtime is declared in three kinds of place, and they have to agree:
//
//   1. every `FROM node:<major>-alpine...` stage in app/Dockerfile — the image
//      that actually ships;
//   2. every `node-version:` pin under .github/workflows/ — what CI tests on;
//   3. the `@types/node` range in app/package.json — what tsc checks against.
//
// They have drifted twice (Issues #210 and #245): Dependabot's `docker`
// ecosystem reads Dockerfiles only, and its npm ecosystem took @types/node to a
// major the image did not run. Both were caught by review rather than by CI.
// This module is the part of the gate that can be tested without a checkout: it
// takes file contents and returns the exact file/line disagreements.

export interface VersionSurface {
  // Repo-relative path. Used only in messages and test assertions.
  path: string;
  // Whole file contents.
  text: string;
}

export interface NodeVersionInput {
  dockerfile: VersionSurface;
  workflows: VersionSurface[];
  packageJson: VersionSurface;
}

export type NodeVersionProblem =
  | { kind: "no-dockerfile-pin"; path: string }
  | { kind: "dockerfile-unparseable"; path: string; line: number; value: string }
  | { kind: "dockerfile-mismatch"; path: string; line: number; declared: string; expected: string }
  | { kind: "workflow-unparseable"; path: string; line: number; value: string }
  | { kind: "workflow-mismatch"; path: string; line: number; declared: string; expected: string }
  | { kind: "types-missing"; path: string }
  | { kind: "types-mismatch"; path: string; line: number; declared: string; expected: string };

interface DockerfilePin {
  line: number;
  major: string | null;
  value: string;
}

const FROM_NODE_RE = /^\s*FROM\s+node:([^\s]+)/i;
const WORKFLOW_NODE_VERSION_RE = /^\s*(?:-\s*)?node-version\s*:\s*(.*?)\s*$/;
const MAJOR_IN_TAG_RE = /^(\d+)(?:[.-]|$)/;

// Strip a YAML inline comment without treating a `#` inside quotes as one.
function stripYamlComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i).trim();
    }
  }
  return raw.trim();
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

// The major out of a Docker tag: `24-alpine`, `24-alpine3.22`, `24.1.0-alpine`
// and a bare `24` all mean 24. A digest suffix is not part of the tag's major.
export function majorFromDockerTag(tag: string): string | null {
  const withoutDigest = tag.split("@")[0];
  const match = MAJOR_IN_TAG_RE.exec(withoutDigest);
  return match === null ? null : match[1];
}

// A workflow pin must be a literal major or version, not a matrix expression. A
// non-literal is reported rather than skipped: silently ignoring it would turn
// the gate off for exactly the workflows most likely to hide a drift.
export function majorFromWorkflowValue(raw: string): string | null {
  const value = unquote(stripYamlComment(raw));
  const match = /^(\d+)(?:\.\d+)*$/.exec(value);
  return match === null ? null : match[1];
}

function dockerfilePins(text: string): DockerfilePin[] {
  const pins: DockerfilePin[] = [];
  text.split("\n").forEach((lineText, index) => {
    const match = FROM_NODE_RE.exec(lineText);
    if (match === null) return;
    pins.push({ line: index + 1, major: majorFromDockerTag(match[1]), value: match[1] });
  });
  return pins;
}

// The reference major for the whole gate. When the Dockerfile stages disagree,
// a majority keeps a single moved `FROM` from redefining the expectation and
// then reporting only the three stages that stayed put; ties fall back to the
// first occurrence, which is deterministic.
function expectedDockerMajor(pins: DockerfilePin[]): string {
  const counts = new Map<string, number>();
  for (const pin of pins) {
    if (pin.major === null) continue;
    counts.set(pin.major, (counts.get(pin.major) ?? 0) + 1);
  }

  let expected: string | null = null;
  let best = 0;
  for (const pin of pins) {
    if (pin.major === null) continue;
    const count = counts.get(pin.major) ?? 0;
    if (count > best) {
      expected = pin.major;
      best = count;
    }
  }
  return expected ?? "";
}

function packageTypesLine(text: string): number | null {
  const index = text.split("\n").findIndex((line) => /"@types\/node"\s*:/.test(line));
  return index === -1 ? null : index + 1;
}

export function findNodeVersionProblems(input: NodeVersionInput): NodeVersionProblem[] {
  const problems: NodeVersionProblem[] = [];
  const pins = dockerfilePins(input.dockerfile.text);

  if (pins.length === 0) {
    return [{ kind: "no-dockerfile-pin", path: input.dockerfile.path }];
  }

  const expected = expectedDockerMajor(pins);
  if (expected === "") {
    // Every FROM node line is unparseable; report those rather than inventing a
    // reference major.
    for (const pin of pins) {
      problems.push({
        kind: "dockerfile-unparseable",
        path: input.dockerfile.path,
        line: pin.line,
        value: pin.value,
      });
    }
    return problems;
  }

  for (const pin of pins) {
    if (pin.major === null) {
      problems.push({
        kind: "dockerfile-unparseable",
        path: input.dockerfile.path,
        line: pin.line,
        value: pin.value,
      });
    } else if (pin.major !== expected) {
      problems.push({
        kind: "dockerfile-mismatch",
        path: input.dockerfile.path,
        line: pin.line,
        declared: pin.major,
        expected,
      });
    }
  }

  for (const workflow of input.workflows) {
    workflow.text.split("\n").forEach((lineText, index) => {
      const match = WORKFLOW_NODE_VERSION_RE.exec(lineText);
      if (match === null) return;

      const major = majorFromWorkflowValue(match[1]);
      const line = index + 1;
      if (major === null) {
        problems.push({
          kind: "workflow-unparseable",
          path: workflow.path,
          line,
          value: unquote(stripYamlComment(match[1])),
        });
      } else if (major !== expected) {
        problems.push({
          kind: "workflow-mismatch",
          path: workflow.path,
          line,
          declared: major,
          expected,
        });
      }
    });
  }

  const typesLine = packageTypesLine(input.packageJson.text);
  if (typesLine === null) {
    problems.push({ kind: "types-missing", path: input.packageJson.path });
  } else {
    const pkg = JSON.parse(input.packageJson.text) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = pkg.devDependencies?.["@types/node"] ?? pkg.dependencies?.["@types/node"];
    if (declared !== `^${expected}`) {
      problems.push({
        kind: "types-mismatch",
        path: input.packageJson.path,
        line: typesLine,
        declared: declared ?? "",
        expected,
      });
    }
  }

  return problems;
}
