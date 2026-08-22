#!/usr/bin/env bash
# ------------------------------------------------------------
# Reports entries in .trivyignore that have stopped doing anything (Issue #291).
#
# THE PROBLEM THIS EXISTS FOR. Nothing removes a suppression when the base image
# is rebuilt. The CVE simply stops being reported, and the line stays in
# .trivyignore, inert — still silencing that ID across all four scans, including
# on images that never had the finding. `exp:` stops a suppression working; it
# does not delete it, and it fires months after the fact. So without something
# like this, the only way to learn an entry is dead is to go looking.
#
# It runs Trivy with --show-suppressed, which reports the findings that WERE
# suppressed, and compares that against the entries in the file. An entry that
# matched nothing in any of the four images is stale and can be deleted.
#
# THIS NEVER FAILS THE BUILD, and that is deliberate. A stale entry is not a
# vulnerability — it is a line that stopped meaning something. Turning the gate
# red for housekeeping is how people learn to stop reading the gate. It prints
# GitHub warning annotations and exits 0, always.
#
# `set -e` is deliberately absent for the same reason: an unexpected failure here
# has to fall through to the exit 0 at the bottom rather than abort the step.
# Errors are handled where they can occur instead.
#
# ONLY ACT ON A VERDICT FROM CI. This scans whatever images are on the machine,
# and a locally built image is not the artifact CI builds: if the cached base
# layer is older than the one CI pulls, packages present in CI's image are simply
# absent from yours, and their suppressions look stale when they are live. That is
# not hypothetical — it happened while writing this (#291). Two entries were
# deleted on a local verdict, from images whose python:3.14-slim was three weeks
# stale, and CI went red on the next push. The script warns when it is not running
# in CI for exactly this reason; heed it.
#
# IT ALSO FAILS SAFE, which matters more than it sounds. Suppressed findings come
# back under `ExperimentalModifiedFindings` — experimental by name, and liable to
# be renamed in a Trivy bump. If that happens, the naive reading is "no entry
# matched anything", i.e. *every* suppression is stale — which is precisely the
# output that would get someone to delete fourteen live suppressions. So zero
# matches across all four images is treated as "could not determine", never as
# "all stale". Watch for that on a Trivy version bump.
#
# Environment:
#   TRIVY_CACHE_DIR   Read natively by Trivy. In CI, point it at the directory
#                     aquasecurity/trivy-action already populated
#                     (${{ github.workspace }}/.cache/trivy) so this reuses the
#                     downloaded database instead of fetching it again.
#
# Run locally with:  ./scripts/check-trivy-suppressions.sh
# (needs `trivy` on PATH and the four images built — see CONTRIBUTING.md.)
# ------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# `|| exit 0`, not `|| exit 1`: even "I could not get to the repository" must not
# turn the image job red. See the header.
cd "$REPO_ROOT" || exit 0

IGNORE_FILE=".trivyignore"
IMAGES=(
    finance-app:latest
    finance-migrate:latest
    finance-importer:latest
    finance-backup:latest
)

log() { echo "[suppressions] $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! command -v trivy >/dev/null 2>&1; then
    log "trivy is not on PATH — skipping the stale-suppression report"
    exit 0
fi
if [ ! -f "$IGNORE_FILE" ]; then
    log "no ${IGNORE_FILE} — nothing to check"
    exit 0
fi

# See the header: outside CI the images are whatever the machine happens to have
# built, and a stale cached base layer produces false staleness. Say so up front
# rather than letting the confident-looking output below be acted on.
if [ -z "${CI:-}" ]; then
    log "NOTE: not running in CI. Anything reported below is only true of the"
    log "      images on this machine — if their base layer is older than the one"
    log "      CI pulls, live suppressions can look stale. Confirm from a CI run"
    log "      before deleting anything."
fi

# --severity and --ignore-unfixed mirror the scan steps in ci.yml, because both
# decide whether a finding is visible at all: a suppression for something the
# gate filters out would look stale when it is merely not currently reported.
#
# --skip-files deliberately does NOT mirror them. Those exclusions cover
# drizzle-kit's esbuild and the postgres image's gosu, and no entry in this file
# refers to either — they are handled at the scanner precisely so they never need
# one. Not skipping them cannot make a suppression falsely stale, so mirroring
# would only duplicate config that can then drift.
scanned=0
for image in "${IMAGES[@]}"; do
    out="${TMP}/$(echo "$image" | tr '/:' '__').json"
    if trivy image --quiet --format json --show-suppressed \
            --severity HIGH,CRITICAL --ignore-unfixed \
            --ignorefile "$IGNORE_FILE" "$image" > "$out" 2>"${out}.err"; then
        scanned=$((scanned + 1))
    else
        log "could not scan ${image} (is it built?) — it will not contribute to this report"
        rm -f "$out"
    fi
done

if [ "$scanned" -eq 0 ]; then
    log "no images could be scanned — skipping the stale-suppression report"
    exit 0
fi

# python3 rather than jq, matching scripts/check-deploy-parity.sh: it is on every
# runner, and the traversal below is more legible than the equivalent jq.
python3 - "$IGNORE_FILE" "$TMP" <<'PY'
import glob, json, os, sys
from datetime import date

ignore_file, tmp = sys.argv[1], sys.argv[2]

# Entries, in file order, with their line number and expiry.
entries = []
with open(ignore_file, encoding="utf-8") as fh:
    for lineno, raw in enumerate(fh, 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        ident = parts[0]
        expiry = None
        for part in parts[1:]:
            if part.startswith("exp:"):
                try:
                    expiry = date.fromisoformat(part[4:])
                except ValueError:
                    pass
        entries.append((ident, lineno, expiry))

# IDs that actually suppressed something, across every image scanned. Walked
# defensively: the container key is experimental, so anything shaped like a
# suppressed finding counts rather than requiring one exact path.
matched = set()
for path in glob.glob(os.path.join(tmp, "*.json")):
    with open(path, encoding="utf-8") as fh:
        try:
            report = json.load(fh)
        except json.JSONDecodeError:
            continue
    for result in report.get("Results") or []:
        for item in result.get("ExperimentalModifiedFindings") or []:
            if item.get("Status") != "ignored":
                continue
            ident = (item.get("Finding") or {}).get("VulnerabilityID")
            if ident:
                matched.add(ident)

print(f"[suppressions] {len(entries)} entries in {ignore_file}; "
      f"{len(matched)} distinct IDs suppressed something across the images scanned")

# Fail safe. Zero matches with entries present means the report shape changed,
# not that every suppression died at once.
if entries and not matched:
    print("::warning::Could not determine which suppressions are live — Trivy "
          "reported no suppressed findings at all. ExperimentalModifiedFindings "
          "is experimental and may have been renamed; check "
          "scripts/check-trivy-suppressions.sh against the current Trivy output "
          "before trusting any staleness result. NOT treating the entries as stale.")
    raise SystemExit(0)

today = date.today()
stale, expired = [], []
for ident, lineno, expiry in entries:
    if ident in matched:
        continue
    if expiry and expiry < today:
        expired.append((ident, lineno, expiry))
    else:
        stale.append((ident, lineno))

for ident, lineno, expiry in expired:
    print(f"::warning file={ignore_file},line={lineno}::{ident} expired on {expiry} "
          f"and is no longer suppressing anything. Its finding is back and failing "
          f"the gate — re-review it rather than deleting it.")

for ident, lineno in stale:
    print(f"::warning file={ignore_file},line={lineno}::{ident} no longer matches a "
          f"finding in any of the images scanned. From a CI run that means upstream "
          f"fixed it — delete this entry and its comment, since nothing removes it "
          f"automatically. From a workstation, confirm against CI first: a cached "
          f"base layer older than the one CI pulls makes live suppressions look dead.")

if not stale and not expired:
    print("[suppressions] ✓ every entry still matches a live finding — nothing to prune")
PY

# Always green: see the header.
exit 0
