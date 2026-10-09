#!/usr/bin/env bash
# Packs the deployment bundle (Issues #227, #347):
#
#   scripts/pack-bundle.sh X.Y.Z OUTDIR
#
# writes OUTDIR/finance-stack-X.Y.Z.tar.gz and its .sha256.
#
# This is the bundle's only producer. release.yml attaches what it writes to
# every GitHub Release, deploy-smoke.yml boots the stack from what it writes,
# and since #347 deploy.sh downloads and verifies it on every upgrade. That
# makes three things an interface that deployed hosts depend on: the file name,
# the single top-level finance-stack-X.Y.Z/ directory, and the sha256sum-format
# checksum file naming the tarball. Renaming any of them breaks upgrades.
#
# WHAT GOES IN. Every git-tracked file under deploy/, so a file added there
# joins the bundle by existing. Tracked files rather than `cp -R deploy`,
# because a checkout where deploy.sh has been run in place holds a real .env,
# dumps and deploy state in deploy/, and none of that may ship. Two things are
# added that are not in deploy/:
#
#   caddy/Caddyfile   copied from the repo root rather than committed under
#                     deploy/, so there is one source of truth and no second
#                     copy to drift. This is why `--profile edge` cannot be
#                     started from deploy/compose.yml inside a checkout.
#   the data dirs     imports/, importer/parsers/ and backups/ are bind mounts.
#                     Shipping them empty means the documented first start
#                     works; without them Docker creates them itself, owned by
#                     root. They cannot simply be committed — .gitignore
#                     excludes `imports/` and `importer/parsers/` at any depth.
#
# STAMPS. Three placeholders become X.Y.Z, and each is asserted to have landed
# exactly once:
#
#   .env.example  APP_VERSION=…               a first install needs no edit (#227)
#   compose.yml   # finance-stack bundle: …   which release the file came from,
#                                             which deploy.sh reads to decide
#                                             whether the file needs refreshing
#                                             and whether it was edited (#347)
#   deploy.sh     DEPLOY_SCRIPT_VERSION=…     what deploy.sh's forward-only
#                                             self-update compares (#347)
#
# The placeholder in git is `changeme` for the first and `unreleased` for the
# other two. deploy.sh treats an `unreleased` compose.yml as a checkout's
# working copy and never refreshes it.
#
# Run locally to rehearse an upgrade against a bundle that matches the
# checkout, rather than one that matches a release:
#
#   scripts/pack-bundle.sh "$(jq -r .version app/package.json)" /tmp/bundles
set -euo pipefail

fail() {
  echo "::error::$*" >&2
  exit 1
}

[ "$#" -eq 2 ] || fail "usage: scripts/pack-bundle.sh X.Y.Z OUTDIR"

VER="${1#v}"
# The same check deploy.sh applies before a version reaches a file name or URL.
printf '%s' "$VER" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$' \
  || fail "'$VER' is not a version — expected X.Y.Z"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$2"
OUT="$(cd "$2" && pwd)"

BUNDLE="finance-stack-$VER"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
DEST="$STAGE/$BUNDLE"
mkdir -p "$DEST"

cd "$REPO_ROOT"

# Tracked files only. The paths below are the ones deploy.sh never installs on
# a host, whatever a bundle carries (#347), so a tracked file there could not
# reach anyone — fail rather than ship something that is silently ignored.
count=0
while IFS= read -r -d '' path; do
  rel="${path#deploy/}"
  case "$rel" in
    .env|compose.override.yml|compose.override.yaml|imports/*|importer/parsers/*|backups/*)
      fail "deploy/$rel is tracked, but deploy.sh never installs that path on a host — it cannot ship in the bundle"
      ;;
  esac
  mkdir -p "$DEST/$(dirname "$rel")"
  cp -p "$path" "$DEST/$rel"
  count=$((count + 1))
done < <(git ls-files -z -- deploy)
[ "$count" -gt 0 ] || fail "git ls-files found nothing under deploy/ — run this from a checkout"

mkdir -p "$DEST/caddy"
cp caddy/Caddyfile "$DEST/caddy/Caddyfile"
mkdir -p "$DEST/imports" "$DEST/importer/parsers" "$DEST/backups"

# Each placeholder must appear exactly once before it is replaced, so a second
# copy (or a reworded one) fails here rather than shipping half-stamped.
stamp() {
  local file="$1" placeholder="$2" stamped="$3" found
  found="$(grep -cxF -- "$placeholder" "$DEST/$file" || true)"
  [ "$found" = "1" ] \
    || fail "expected exactly one '$placeholder' line in deploy/$file, found $found"
  # awk compares whole lines as strings, so neither the placeholder nor the
  # version is ever read as a pattern.
  awk -v from="$placeholder" -v to="$stamped" '$0 == from { print to; next } { print }' \
    "$DEST/$file" > "$DEST/$file.stamped"
  chmod --reference="$DEST/$file" "$DEST/$file.stamped"
  mv "$DEST/$file.stamped" "$DEST/$file"
  grep -qxF -- "$stamped" "$DEST/$file" || fail "deploy/$file was not stamped with $VER"
}

# APP_VERSION's placeholder is whatever the template carries; normalise it to
# the exact line first, since it is the one stamp that predates #347.
app_version_line="$(grep -E '^APP_VERSION=' "$DEST/.env.example" || true)"
[ "$(printf '%s\n' "$app_version_line" | grep -c '^APP_VERSION=')" = "1" ] \
  || fail "expected exactly one APP_VERSION= line in deploy/.env.example"
stamp .env.example "$app_version_line" "APP_VERSION=$VER"
stamp compose.yml "# finance-stack bundle: unreleased" "# finance-stack bundle: $VER"
stamp deploy.sh 'DEPLOY_SCRIPT_VERSION="unreleased"' "DEPLOY_SCRIPT_VERSION=\"$VER\""

# -C so the archive has exactly one top-level directory and unpacking never
# scatters files into the operator's cwd. deploy.sh refuses anything else.
tar -czf "$OUT/$BUNDLE.tar.gz" -C "$STAGE" "$BUNDLE"
# From inside OUT, so the checksum line names the bare file — the format
# deploy.sh verifies, and the one `sha256sum -c` expects beside the tarball.
(cd "$OUT" && sha256sum "$BUNDLE.tar.gz" > "$BUNDLE.tar.gz.sha256")

echo "--- $BUNDLE.tar.gz ---"
tar -tzf "$OUT/$BUNDLE.tar.gz"
cat "$OUT/$BUNDLE.tar.gz.sha256"
