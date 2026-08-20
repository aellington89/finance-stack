#!/usr/bin/env bash
# CI gate (Issue #227): asserts that deploy/compose.yml and the repo-root
# docker-compose.yml still describe the same stack.
#
# Two compose files describing one stack drift. The release workflow smoke-tests
# the file that ships, which catches functional drift at tag time; this catches
# the rest — a resource limit, healthcheck, environment entry or depends_on
# condition edited in one file and not the other — on the PR that introduces it.
#
# How it works: `docker compose config` renders both files to normalized JSON,
# the two INTENDED differences are asserted and then stripped, and whatever is
# left must be identical.
#
#   1. build:  present only in the dev file, dropped
#   2. image:  IMAGE_REGISTRY=local below, so the deploy file renders
#              local/finance-app:latest; the prefix is stripped and it must then
#              equal the dev file's finance-app:latest
#   3. finance-app ports: asserted absent (all interfaces) in the dev file and
#              127.0.0.1 in the deploy file, then dropped. Every other service's
#              host_ip is still compared — postgres and metabase are loopback in
#              both, and a change to that must fail here.
#
# Bind-mount sources are resolved by Compose to absolute paths against each
# file's own project directory, so those two prefixes are collapsed to a token.
#
# It also compares the two .env.example variable sets, which is what keeps
# "deploy/.env.example documents every required variable" true over time.
#
# Run locally with: ./scripts/check-deploy-parity.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DEV_FILE="docker-compose.yml"
DEPLOY_FILE="deploy/compose.yml"
DEV_ENV=".env.example"
DEPLOY_ENV="deploy/.env.example"

# The two names deploy/.env.example is allowed to add. Anything else is drift.
DEPLOY_ONLY_VARS="APP_VERSION IMAGE_REGISTRY"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "::error::$1"
  FAILED=1
}
FAILED=0

# Placeholder values for every variable without a default in either file, so
# `config` renders without warnings and both sides see identical inputs.
render() {
  POSTGRES_USER=placeholder \
  POSTGRES_PASSWORD=placeholder \
  POSTGRES_DB=placeholder \
  FINANCE_APP_DB_PASSWORD=placeholder \
  FINANCE_IMPORTER_DB_PASSWORD=placeholder \
  FINANCE_BI_DB_PASSWORD=placeholder \
  MB_DB_USER=placeholder \
  MB_DB_DBNAME=placeholder \
  MB_DB_PASS=placeholder \
  AUTH_SECRET=placeholder \
  IMAGE_REGISTRY=local \
  APP_VERSION=latest \
  docker compose \
    --env-file /dev/null \
    --file "$1" \
    --profile init --profile bi --profile edge \
    config --format json
}

# --env-file /dev/null is load-bearing, not tidiness: without it a developer's
# real root .env feeds the dev side while the deploy side (project directory
# deploy/, no .env of its own) gets nothing, and the gate fails locally while
# passing in CI.
render "$DEV_FILE"    > "$TMP/dev.json"
render "$DEPLOY_FILE" > "$TMP/deploy.json"

normalize() {
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys

path, side, project_dir = sys.argv[1], sys.argv[2], sys.argv[3]

with open(path) as fh:
    doc = json.load(fh)

problems = []

for name, svc in doc.get("services", {}).items():
    # 1. build: — the dev file builds, the deploy file pulls.
    svc.pop("build", None)

    # 2. image: — strip the placeholder registry namespace the deploy file
    #    renders, so both sides read finance-app:latest.
    image = svc.get("image")
    if image and image.startswith("local/"):
        svc["image"] = image[len("local/"):]

    # 3. finance-app's host binding, asserted rather than ignored.
    if name == "finance-app":
        for port in svc.get("ports", []):
            host_ip = port.pop("host_ip", None)
            if side == "deploy" and host_ip != "127.0.0.1":
                problems.append(
                    "deploy/compose.yml: finance-app must publish on 127.0.0.1 "
                    f"(got {host_ip or 'all interfaces'}). A deployment host binds "
                    "loopback so a TLS proxy is the only public listener."
                )
            if side == "dev" and host_ip is not None:
                problems.append(
                    "docker-compose.yml: finance-app must publish on all interfaces "
                    f"(got {host_ip}). That is how the app is reached from another "
                    "machine on a trusted network; only the deploy file binds loopback."
                )

    # Bind sources are absolute and project-directory-relative; collapse them.
    for volume in svc.get("volumes", []):
        source = volume.get("source", "")
        if volume.get("type") == "bind" and source.startswith(project_dir):
            volume["source"] = "<project>" + source[len(project_dir):]

if problems:
    for problem in problems:
        print(f"::error::{problem}", file=sys.stderr)
    sys.exit(2)

print(json.dumps(doc, indent=2, sort_keys=True))
PY
}

echo "Comparing $DEPLOY_FILE against $DEV_FILE…"

normalize "$TMP/dev.json"    dev    "$REPO_ROOT"         > "$TMP/dev.norm"
normalize "$TMP/deploy.json" deploy "$REPO_ROOT/deploy"  > "$TMP/deploy.norm"

if ! diff -u --label "$DEV_FILE" "$TMP/dev.norm" --label "$DEPLOY_FILE" "$TMP/deploy.norm"; then
  fail "$DEPLOY_FILE and $DEV_FILE have diverged — see the diff above. \
Make the same edit in both files. Only three differences are permitted: build:, \
the image: registry prefix, and finance-app's loopback binding."
else
  echo "✓ compose files agree"
fi

# .env.example variable sets. Matches NAME= and the commented-out # NAME= form
# that PUBLIC_HOSTNAME uses; prose comments have no = after the first word.
env_names() {
  grep -oE '^#? ?[A-Z_][A-Z0-9_]*=' "$1" | tr -d '# ' | tr -d '=' | sort -u
}

env_names "$DEV_ENV"     > "$TMP/dev.vars"
env_names "$DEPLOY_ENV"  > "$TMP/deploy.vars"

# shellcheck disable=SC2086  # word splitting is how the allowlist is consumed
printf '%s\n' $DEPLOY_ONLY_VARS | sort -u > "$TMP/allowed.vars"
sort -u -m "$TMP/dev.vars" "$TMP/allowed.vars" > "$TMP/expected.vars"

if ! diff -u --label "expected ($DEV_ENV + APP_VERSION + IMAGE_REGISTRY)" "$TMP/expected.vars" \
              --label "$DEPLOY_ENV" "$TMP/deploy.vars"; then
  fail "$DEPLOY_ENV does not document the same variables as $DEV_ENV. \
A deployment host has no source tree, so a variable missing here is a variable \
nobody can set. Add or remove it in both files."
else
  echo "✓ .env.example variable sets agree"
fi

exit "$FAILED"
