#!/usr/bin/env bash
# Builds the finance stack's images, with version metadata stamped into
# finance-app from git.
#
# Plain `docker compose up --build` works without this (gitSha falls back to
# "dev"); use this wrapper when you want a SHA/timestamp-stamped local build.
#
# All four services by default (Issue #224). Since the migrate image bakes in
# init-db/roles and init-db/seeds, building only finance-app leaves a stale
# migrate image that applies the seeds it was built with and reports success —
# a silent no-op, not a failure. Name services to narrow it; flags are passed
# through to `docker compose build` either way:
#
#   scripts/build.sh                       # all four
#   scripts/build.sh importer              # just the importer
#   scripts/build.sh --no-cache            # all four, no cache
#   scripts/build.sh --no-cache migrate    # one service, no cache
#
# GIT_SHA/BUILD_TIME are build args on finance-app only; compose ignores them
# for the other three.
set -euo pipefail

DEFAULT_SERVICES=(finance-app migrate importer pg-backup)

GIT_SHA="$(git rev-parse --short HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export GIT_SHA BUILD_TIME

# Split flags from service names, so a bare `--no-cache` still builds the full
# default set rather than being mistaken for one.
flags=()
services=()
for arg in "$@"; do
  case "$arg" in
    -*) flags+=("$arg") ;;
    *)  services+=("$arg") ;;
  esac
done
if [ "${#services[@]}" -eq 0 ]; then
  services=("${DEFAULT_SERVICES[@]}")
fi

echo "Building ${services[*]}  GIT_SHA=${GIT_SHA}  BUILD_TIME=${BUILD_TIME}"
exec docker compose build ${flags[@]+"${flags[@]}"} "${services[@]}"
