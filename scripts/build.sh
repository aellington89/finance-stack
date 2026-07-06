#!/usr/bin/env bash
# Builds the finance-app image with version metadata stamped in from git.
# Plain `docker compose up --build` works without this (gitSha falls back to "dev");
# use this wrapper when you want a SHA/timestamp-stamped local build.
set -euo pipefail

export GIT_SHA="$(git rev-parse --short HEAD)"
export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Building finance-app  GIT_SHA=${GIT_SHA}  BUILD_TIME=${BUILD_TIME}"
exec docker compose build finance-app "$@"
