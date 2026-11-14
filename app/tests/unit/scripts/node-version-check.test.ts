import { describe, expect, it } from "vitest";

import {
  findNodeVersionProblems,
  type NodeVersionInput,
} from "@/scripts/node-version-check";

// One Dockerfile with four stages, the two workflow shapes that matter (a
// setup-node step and a workflow that has none), and the matching devDependency.
// Every test below changes exactly one surface from this baseline, so a failure
// names the surface that drifted rather than everything that could have.
const DOCKERFILE = `\
# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
FROM node:24-alpine AS build
FROM node:24-alpine AS migrate
FROM node:24-alpine AS runner
`;

const CI_WORKFLOW = `\
jobs:
  ci:
    steps:
      - uses: actions/setup-node@v7
        with:
          node-version: 24
  e2e:
    steps:
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
`;

// A workflow with no setup-node step. It must not be reported as missing a pin;
// there is nothing here that declares a runtime.
const RETARGET_WORKFLOW = `\
jobs:
  retarget:
    steps:
      - uses: actions/checkout@v7
      - run: gh pr edit --base master
`;

const PACKAGE_JSON = `\
{
  "name": "finance-stack",
  "devDependencies": {
    "@types/node": "^24",
    "typescript": "~6.0"
  }
}
`;

function input(overrides: Partial<NodeVersionInput> = {}): NodeVersionInput {
  return {
    dockerfile: { path: "app/Dockerfile", text: DOCKERFILE },
    workflows: [
      { path: ".github/workflows/ci.yml", text: CI_WORKFLOW },
      { path: ".github/workflows/dependabot-retarget.yml", text: RETARGET_WORKFLOW },
    ],
    packageJson: { path: "app/package.json", text: PACKAGE_JSON },
    ...overrides,
  };
}

describe("findNodeVersionProblems", () => {
  it("passes when the Dockerfile, every workflow pin and @types/node agree", () => {
    expect(findNodeVersionProblems(input())).toEqual([]);
  });

  it("accepts a FROM tag variant that carries an Alpine point release", () => {
    const dockerfile = DOCKERFILE.replace("node:24-alpine AS deps", "node:24-alpine3.22 AS deps");

    expect(findNodeVersionProblems(input({ dockerfile: { path: "app/Dockerfile", text: dockerfile } }))).toEqual([]);
  });

  it("fails when one Dockerfile stage is moved alone, naming its line", () => {
    const dockerfile = DOCKERFILE.replace("node:24-alpine AS build", "node:26-alpine AS build");

    expect(
      findNodeVersionProblems(input({ dockerfile: { path: "app/Dockerfile", text: dockerfile } })),
    ).toEqual([
      {
        kind: "dockerfile-mismatch",
        path: "app/Dockerfile",
        line: 3,
        declared: "26",
        expected: "24",
      },
    ]);
  });

  it("fails when a workflow is moved alone, naming the file and line", () => {
    const workflow = CI_WORKFLOW.replace("node-version: 24", "node-version: 26");

    expect(findNodeVersionProblems(input({ workflows: [{ path: ".github/workflows/ci.yml", text: workflow }] }))).toEqual([
      {
        kind: "workflow-mismatch",
        path: ".github/workflows/ci.yml",
        line: 6,
        declared: "26",
        expected: "24",
      },
    ]);
  });

  it("fails when @types/node is moved alone, naming the package.json line", () => {
    const packageJson = PACKAGE_JSON.replace('"@types/node": "^24"', '"@types/node": "^26"');

    expect(
      findNodeVersionProblems(input({ packageJson: { path: "app/package.json", text: packageJson } })),
    ).toEqual([
      {
        kind: "types-mismatch",
        path: "app/package.json",
        line: 4,
        declared: "^26",
        expected: "24",
      },
    ]);
  });

  it("does not treat a workflow with no setup-node step as a missing pin", () => {
    expect(
      findNodeVersionProblems(
        input({ workflows: [{ path: ".github/workflows/dependabot-retarget.yml", text: RETARGET_WORKFLOW }] }),
      ),
    ).toEqual([]);
  });

  it("reports a Dockerfile whose stages disagree with each other", () => {
    const dockerfile = `\
FROM node:24-alpine AS deps
FROM node:26-alpine AS build
FROM node:24-alpine AS runner
`;

    expect(
      findNodeVersionProblems(input({ dockerfile: { path: "app/Dockerfile", text: dockerfile } })),
    ).toEqual([
      {
        kind: "dockerfile-mismatch",
        path: "app/Dockerfile",
        line: 2,
        declared: "26",
        expected: "24",
      },
    ]);
  });

  it("reports an unreadable FROM node tag rather than silently skipping it", () => {
    const dockerfile = DOCKERFILE.replace("node:24-alpine AS deps", "node:${NODE_VERSION} AS deps");

    expect(
      findNodeVersionProblems(input({ dockerfile: { path: "app/Dockerfile", text: dockerfile } })),
    ).toEqual([
      {
        kind: "dockerfile-unparseable",
        path: "app/Dockerfile",
        line: 2,
        value: "${NODE_VERSION}",
      },
    ]);
  });

  it("reports a non-literal workflow node-version", () => {
    const workflow = CI_WORKFLOW.replace("node-version: 24", "node-version: ${{ matrix.node }}");

    expect(findNodeVersionProblems(input({ workflows: [{ path: ".github/workflows/ci.yml", text: workflow }] }))).toEqual([
      {
        kind: "workflow-unparseable",
        path: ".github/workflows/ci.yml",
        line: 6,
        value: "${{ matrix.node }}",
      },
    ]);
  });

  it("reports a Dockerfile with no FROM node stage", () => {
    expect(
      findNodeVersionProblems(
        input({ dockerfile: { path: "app/Dockerfile", text: "FROM alpine:3\n" } }),
      ),
    ).toEqual([{ kind: "no-dockerfile-pin", path: "app/Dockerfile" }]);
  });

  it("reports a package.json with no @types/node entry", () => {
    expect(
      findNodeVersionProblems(
        input({ packageJson: { path: "app/package.json", text: '{\n  "name": "finance-stack"\n}\n' } }),
      ),
    ).toEqual([{ kind: "types-missing", path: "app/package.json" }]);
  });
});
