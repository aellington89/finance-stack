#!/usr/bin/env bash
# ------------------------------------------------------------
# Install and upgrade a Finance Stack deployment (Issues #228, #347).
#
#   ./deploy.sh 0.4.1     # install or upgrade to 0.4.1
#   ./deploy.sh           # converge on whatever APP_VERSION .env already pins
#
# This is the single entry point, so an upgrade is never a sequence of
# remembered commands, and so every upgrade has a guaranteed restore point
# before any schema change is applied. It is idempotent: re-running it with the
# already-deployed version converges the stack and changes nothing else.
#
# ORDER OF OPERATIONS — the ordering IS the feature:
#
#   preflight → bundle(target) → pull(target) → backup gate → pin .env + files → up -d → health gate
#                                                                  │                                │
#                                                                  └──────────── rollback ──────────┘
#
#   * The bundle comes first (#347). It is fetched, verified and unpacked into
#     a scratch directory, so a missing release or a bad tarball fails before
#     anything here changes, and the pull reads the TARGET's compose.yml from
#     there — a release that bumps postgres or metabase gets those images
#     pulled too.
#   * The pull runs BEFORE .env is touched. `docker compose pull` resolves
#     ${APP_VERSION} from .env, so pinning first and pulling second would be
#     fine — but pulling first with APP_VERSION exported for that one command
#     (a shell variable outranks .env in Compose interpolation) means a bad or
#     nonexistent version fails with .env still pristine and nothing running
#     touched.
#   * The dump runs BEFORE .env is re-pinned and the bundle's files go in, and
#     with --no-deps. pg-backup declares `depends_on: migrate:
#     service_completed_successfully`, and `docker compose run` honours
#     depends_on — so without --no-deps, the command whose entire job is "dump
#     before migrate runs" would start migrate. Taking the dump before
#     re-pinning is the second belt: even if a dependency did fire, it would be
#     the already-applied old migrate. It also reads the files already here,
#     so a stopped stack's postgres comes up on its current image rather than
#     on one the target release introduces.
#   * The dump also needs --entrypoint, not a trailing command. pg-backup's
#     entrypoint is a `bash -c "<sleep loop>"`, so a trailing /scripts/backup.sh
#     becomes $0 of that loop and the container spins forever. (deploy/README.md
#     documents the `exec` form, which works because exec bypasses entrypoints.)
#
# THE BUNDLE IS THE UNIT OF UPGRADE (#347). Before #347 only APP_VERSION moved,
# so every host kept the compose.yml of whichever bundle it was first installed
# from: third-party image bumps, new services and new environment wiring never
# arrived, and nothing noticed, because the health gate checks the app's
# version and nothing else. Now an upgrade installs the target's
# finance-stack-X.Y.Z.tar.gz — from DEPLOY_BUNDLE, else the cache in .bundles/,
# else the GitHub release — checked against its .sha256 before it is unpacked.
# At the moment .env is pinned:
#
#   compose.yml, caddy/Caddyfile   installed, unless edited here. An edited
#                                  compose.yml that the release also changes
#                                  stops the deploy: local changes belong in
#                                  compose.override.yml, which Compose reads on
#                                  its own. An edited Caddyfile is kept, and the
#                                  release's copy written beside it as
#                                  caddy/Caddyfile.dist.
#   everything else it ships       installed (README.md, .env.example, …).
#   deploy.sh                      replaced only after a successful deploy, and
#                                  never by an older script.
#   never touched                  .env (apart from APP_VERSION),
#                                  compose.override.yml, imports/,
#                                  importer/parsers/, backups/.
#
# Whatever is replaced goes back together with .env on rollback, and is kept in
# .bundle-backup/ after a successful run. compose.yml's first line names the
# release it was packed from; when no bundle can be had, a compose.yml already
# stamped with the target is used as it is, and anything else stops the deploy
# rather than run new images on an old stack definition. Optional services that
# are running (--profile bi, errors, edge) are re-applied on the deployed
# definition once the app is healthy, since a plain `up -d` leaves them alone.
#
# THE HEALTH GATE IS ONE CONDITION, NOT TWO. release.yml polls until 200 and
# then asserts the version once; that is correct for a fresh boot and wrong for
# an upgrade, where the OLD container answers 200 with the OLD version while the
# new one is still starting. This polls until 200 AND build.version == target,
# and only the timeout ends it. `curl -fsS` exits non-zero on the 503 the route
# returns when the database is unreachable, so a degraded stack keeps the loop
# waiting rather than passing the gate.
#
# ROLLBACK RESTORES THE APPLICATION, NOT THE DATABASE. drizzle-kit generates no
# down migrations, so where a release carried a schema change the previous app
# may not run against the new schema. That is why the pre-upgrade dump is a gate
# rather than a nicety, and why this script prints the exact restore command
# rather than implying the rollback was complete.
#
# EXIT CODES:
#   0  success
#   1  aborted before anything was applied (preflight, the bundle, the pull or
#      the dump failed, or an edited compose.yml conflicts with the release) —
#      the running stack, .env and every file here are untouched
#   2  upgrade failed, rollback succeeded, the previous version is healthy and
#      the previous files are back
#   3  upgrade failed AND rollback failed — needs a human
#
# ENVIRONMENT (script-only overrides; deliberately NOT in .env.example, which
# may carry exactly two variables the root template does not — see
# scripts/check-deploy-parity.sh):
#   DEPLOY_SKIP_PULL=1      skip `docker compose pull` (CI, or an offline host
#                           whose images are already present)
#   DEPLOY_HEALTH_URL       default http://127.0.0.1:3001/api/health
#   DEPLOY_HEALTH_TIMEOUT   seconds to wait for the health gate (default 180)
#   DEPLOY_BUNDLE           the target's finance-stack-X.Y.Z.tar.gz, for an
#                           offline host or CI; its .sha256 must sit beside it
#   DEPLOY_RELEASE_URL      where bundles are downloaded from, for a fork or a
#                           mirror (default
#                           https://github.com/aellington89/finance-stack/releases/download)
#   DEPLOY_SKIP_BUNDLE=1    deploy with the files already here, as before #347
#
# Requires curl, tar and sha256sum. Uses jq if it is installed and falls back to
# a text extraction if it is not, so on any Linux host the bundle's "Docker
# Engine and the Compose plugin" is still the whole requirement list.
# ------------------------------------------------------------
set -euo pipefail

# The release this script was packed from. scripts/pack-bundle.sh stamps it
# (#347); a checkout's copy says `unreleased`. The self-update compares it.
DEPLOY_SCRIPT_VERSION="unreleased"

# Resolve the script's own path BEFORE the cd, so --help can still read it: $0 is
# whatever the caller typed, and a relative path stops resolving the moment the
# working directory changes.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "$SELF")"

ENV_FILE=".env"
STATE_FILE=".deployed-version"
BACKUP_DIR_HOST="backups"
BACKUP_DIR_CONTAINER="/backups"
# Verified bundles for the deployed and the previous release, and the files the
# last successful run replaced (#347).
BUNDLE_CACHE=".bundles"
BUNDLE_BACKUP=".bundle-backup"

HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3001/api/health}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-180}"
RELEASE_URL="${DEPLOY_RELEASE_URL:-https://github.com/aellington89/finance-stack/releases/download}"
RELEASE_URL="${RELEASE_URL%/}"

# Compose's own precedence for the project name, which is what every volume and
# container is prefixed with: COMPOSE_PROJECT_NAME, then the top-level `name:` in
# compose.yml, then the directory. Derived rather than hardcoded to
# finance-stack_postgres_data, because getting this wrong in either direction is
# expensive: a name that does not exist reads a live deployment as a first
# install and skips the backup gate, and a name belonging to someone else's
# project reads a genuinely empty host as an upgrade. Takes another compose file
# to read instead, for comparing a release's against the one here (#347).
compose_project_name() {
    local file="${1:-compose.yml}" from_file
    if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
        printf '%s' "$COMPOSE_PROJECT_NAME"
        return
    fi
    from_file="$(sed -nE 's/^name:[[:space:]]*"?([A-Za-z0-9._-]+)"?.*/\1/p' "$file" 2>/dev/null | head -n1)"
    printf '%s' "${from_file:-$(basename "$PWD")}"
}

log()  { echo "[deploy] $*"; }
warn() { echo "[deploy] WARNING: $*" >&2; }
die()  { echo "[deploy] ERROR: $*" >&2; exit 1; }

WORK_DIR="$(mktemp -d)"
ENV_PRISTINE="${WORK_DIR}/env.pristine"
ENV_DIRTY=0
# Before the bundle's files go in, the ones they replace are copied here and the
# ones they create are listed, so a rollback or an abort can put things back
# exactly as they were (#347).
SNAPSHOT_DIR="${WORK_DIR}/snapshot"
SNAPSHOT_PATHS=()
SNAPSHOT_NEW=()
FILES_DIRTY=0

cleanup() {
    # Put back what this run changed if it is aborting before either committing
    # the upgrade or completing a rollback: the bundle's files (#347), and .env's
    # APP_VERSION. Covers Ctrl-C and any unexpected failure between the pin and
    # the commit.
    if [ "$FILES_DIRTY" -eq 1 ]; then
        snapshot_restore || true
        warn "aborted after installing the bundle's files — the previous ones are back"
    fi
    if [ "$ENV_DIRTY" -eq 1 ] && [ -f "$ENV_PRISTINE" ]; then
        cp "$ENV_PRISTINE" "$ENV_FILE"
        warn "aborted after pinning — ${ENV_FILE} restored to its previous APP_VERSION"
    fi
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT
# Ctrl-C and a plain kill become an ordinary exit, so the cleanup above runs for
# them too.
trap 'exit 130' INT
trap 'exit 143' TERM

# ------------------------------------------------------------
# .env access
#
# Read, never source: this file is the deployment's whole secret store and its
# values may contain #, spaces or shell metacharacters. Strips one layer of
# surrounding quotes, which Compose also does. Also used on .env.example files,
# which follow the same format.
# ------------------------------------------------------------
env_file_get() {
    local file="$1" name="$2" value
    value="$(grep -E "^${name}=" "$file" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    printf '%s' "$value"
}

env_get() { env_file_get "$ENV_FILE" "$1"; }

env_has() { grep -qE "^${1}=" "$ENV_FILE" 2>/dev/null; }

# Fail fast and loudly on a missing value, the same reasoning as the `:?` guards
# in app/scripts/migrate-and-seed.sh: Compose substitutes an unset variable with
# the empty string rather than erroring, so a stale .env otherwise fails deep
# inside a container instead of here. A function rather than the `:?` idiom
# itself only because these values come out of a file, not the environment.
require_env_var() {
    local name="$1" value
    value="$(env_get "$name")"
    [ -n "$value" ] || die "${name} is empty or missing in ${ENV_FILE} — copy it from .env.example and set a real value"
    case "$value" in
        changeme*) die "${name} is still the '${value}' placeholder in ${ENV_FILE} — set a real value before deploying" ;;
    esac
}

# Rewrite APP_VERSION in place, atomically, preserving the file's mode. Appends
# the key if it is absent. .env is mode 600 on a deployment host and must stay
# that way across every pin and rollback.
pin_version() {
    local version="$1" tmp="${ENV_FILE}.deploy.tmp"

    if [ ! -f "$ENV_PRISTINE" ]; then
        cp "$ENV_FILE" "$ENV_PRISTINE"
    fi

    if grep -qE '^APP_VERSION=' "$ENV_FILE"; then
        awk -v v="$version" '/^APP_VERSION=/ { print "APP_VERSION=" v; next } { print }' \
            "$ENV_FILE" > "$tmp"
    else
        cp "$ENV_FILE" "$tmp"
        printf 'APP_VERSION=%s\n' "$version" >> "$tmp"
    fi

    chmod --reference="$ENV_FILE" "$tmp" 2>/dev/null || chmod 600 "$tmp"
    mv "$tmp" "$ENV_FILE"
    ENV_DIRTY=1
    log "pinned APP_VERSION=${version} in ${ENV_FILE}"
}

# ------------------------------------------------------------
# Health gate
# ------------------------------------------------------------

# jq when it is there, a text extraction when it is not. "version" appears once
# in the payload ({"status":…,"db":…,"build":{"version":…,"gitSha":…}}).
json_version() {
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$1" | jq -r '.build.version // empty'
    else
        printf '%s' "$1" \
            | grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]*"' \
            | head -n1 \
            | sed -E 's/.*:[[:space:]]*"([^"]*)"$/\1/'
    fi
}

# Polls until the endpoint returns 200 AND reports the wanted version. Returns 1
# on timeout. See the header: folding both conditions into one loop is what
# makes this correct during an upgrade, when the old container is still serving.
poll_health() {
    local want="$1" elapsed=0 body got

    log "polling ${HEALTH_URL} for a 200 reporting version ${want} (timeout ${HEALTH_TIMEOUT}s)…"
    while :; do
        if body="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
            got="$(json_version "$body")"
            if [ "$got" = "$want" ]; then
                log "✓ healthy — /api/health reports version ${got}"
                return 0
            fi
        fi
        if [ "$elapsed" -ge "$HEALTH_TIMEOUT" ]; then
            return 1
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done
}

# The same diagnostics release.yml captures on a failed boot.
dump_diagnostics() {
    echo "--- last /api/health body (with status) ---"
    curl -s -w '\nHTTP %{http_code}\n' "$HEALTH_URL" || true
    echo "--- migrate logs ---"
    docker compose logs --no-color --tail=200 migrate || true
    echo "--- finance-app logs ---"
    docker compose logs --no-color --tail=200 finance-app || true
}

# ------------------------------------------------------------
# Release bundles (#347)
# ------------------------------------------------------------

# The release a compose.yml was packed from: the first-line stamp
# scripts/pack-bundle.sh writes. Empty for a file that predates the stamp, and
# `unreleased` for a checkout's working copy.
compose_stamp() {
    sed -nE 's/^# finance-stack bundle: ([0-9A-Za-z.+-]+)[[:space:]]*$/\1/p' "$1" 2>/dev/null | head -n1
}

# compose.yml minus its stamp, so two copies are compared on what Compose
# actually reads: every release's copy differs from the last on that one line.
compose_body() {
    sed '/^# finance-stack bundle: /d' "$1"
}

same_file()    { cmp -s "$1" "$2"; }
same_compose() { cmp -s <(compose_body "$1") <(compose_body "$2"); }

# A >= B. sort -V orders 1.10.0 after 1.9.0, which a string comparison does not,
# but it sorts 1.3.0-rc.1 AFTER 1.3.0 — the opposite of semver — so the X.Y.Z
# cores are compared first, and a suffix only breaks a tie, which the plain
# release wins.
version_ge() {
    local a="$1" b="$2" a_core b_core
    [ "$a" = "$b" ] && return 0
    a_core="${a%%[-+]*}"
    b_core="${b%%[-+]*}"
    if [ "$a_core" != "$b_core" ]; then
        [ "$(printf '%s\n%s\n' "$a_core" "$b_core" | sort -V | tail -n1)" = "$a_core" ]
        return
    fi
    [ "$a" = "$a_core" ] && return 0
    [ "$b" = "$b_core" ] && return 1
    [ "$(printf '%s\n%s\n' "$a" "$b" | sort -V | tail -n1)" = "$a" ]
}

# Whether TGZ matches SHA, a sha256sum-format line that must name NAME. The hash
# is compared here rather than with `sha256sum -c`, which checks whichever file
# the line names — a checksum file naming some other file would pass.
bundle_checksum_ok() {
    local tgz="$1" sha="$2" name="$3" want="" named="" got
    [ -f "$tgz" ] && [ -f "$sha" ] || return 1
    { read -r want named || [ -n "$want" ]; } < "$sha" || return 1
    [ "${named#\*}" = "$name" ] || return 1
    printf '%s' "$want" | grep -qE '^[0-9a-f]{64}$' || return 1
    got="$(sha256sum < "$tgz" | cut -d' ' -f1)"
    [ "$got" = "$want" ]
}

# Every member of TGZ must be a plain file or directory under TOP/: no symlinks,
# hard links or devices, no absolute paths, no `..`. Checked before anything is
# unpacked, because a link unpacked first can aim a later member outside the
# scratch directory. scripts/pack-bundle.sh produces nothing else.
bundle_members_ok() {
    local tgz="$1" top="$2" listing names line
    listing="$(tar -tvzf "$tgz" 2>/dev/null)" || return 1
    names="$(tar -tzf "$tgz" 2>/dev/null)" || return 1
    [ -n "$names" ] || return 1
    while IFS= read -r line; do
        case "${line:0:1}" in
            -|d) ;;
            *) return 1 ;;
        esac
    done <<< "$listing"
    while IFS= read -r line; do
        case "$line" in
            "$top"/*) ;;
            *) return 1 ;;
        esac
        case "/${line}/" in
            */../*) return 1 ;;
        esac
    done <<< "$names"
}

# Unpacks the verified bundle TGZ for VERSION into DEST and prints the directory
# it unpacked to. Refuses anything but the single finance-stack-VERSION/
# directory of plain files scripts/pack-bundle.sh produces, holding a
# compose.yml and an .env.example that pins VERSION — the stamp every bundle
# has carried since v0.4.0, so a deliberate rollback to an old release works.
bundle_unpack() {
    local tgz="$1" version="$2" dest="$3" top="finance-stack-$2"
    if ! bundle_members_ok "$tgz" "$top"; then
        warn "$(basename "$tgz") holds something other than plain files under ${top}/"
        return 1
    fi
    mkdir -p "$dest"
    tar -xzf "$tgz" -C "$dest" --no-same-owner || return 1
    if [ ! -f "${dest}/${top}/compose.yml" ] \
       || [ "$(env_file_get "${dest}/${top}/.env.example" APP_VERSION)" != "$version" ]; then
        warn "$(basename "$tgz") is not the ${version} bundle: it has no compose.yml, or its .env.example pins another APP_VERSION"
        return 1
    fi
    printf '%s' "${dest}/${top}"
}

# VERSION's bundle from the cache, else downloaded from the release, into
# FETCH_TGZ / FETCH_SHA / FETCH_FROM. Returns 1 when neither has it. A download
# that arrives but fails its checksum is a corrupt or substituted file rather
# than a missing one, so with STRICT=1 it stops the deploy.
FETCH_TGZ=""
FETCH_SHA=""
FETCH_FROM=""
bundle_fetch() {
    local version="$1" strict="$2" name dir url
    name="finance-stack-${version}.tar.gz"
    FETCH_TGZ=""
    FETCH_SHA=""
    FETCH_FROM=""

    if [ -f "${BUNDLE_CACHE}/${name}" ]; then
        if bundle_checksum_ok "${BUNDLE_CACHE}/${name}" "${BUNDLE_CACHE}/${name}.sha256" "$name"; then
            FETCH_TGZ="${BUNDLE_CACHE}/${name}"
            FETCH_SHA="${FETCH_TGZ}.sha256"
            FETCH_FROM="${BUNDLE_CACHE}/"
            return 0
        fi
        warn "${BUNDLE_CACHE}/${name} fails its checksum — ignoring the cached copy"
    fi

    dir="${WORK_DIR}/download/${version}"
    url="${RELEASE_URL}/v${version}/${name}"
    mkdir -p "$dir"
    curl -fsSL --proto '=https' --proto-redir '=https' --retry 3 --connect-timeout 10 --max-time 300 \
        -o "${dir}/${name}" "$url" || return 1
    curl -fsSL --proto '=https' --proto-redir '=https' --retry 3 --connect-timeout 10 --max-time 60 \
        -o "${dir}/${name}.sha256" "${url}.sha256" || return 1
    if ! bundle_checksum_ok "${dir}/${name}" "${dir}/${name}.sha256" "$name"; then
        if [ "$strict" = "1" ]; then
            die "${url} downloaded, but fails its checksum — nothing has been changed. Retry, or fetch it by hand and use DEPLOY_BUNDLE."
        fi
        warn "${url} downloaded, but fails its checksum — ignoring it"
        return 1
    fi
    FETCH_TGZ="${dir}/${name}"
    FETCH_SHA="${FETCH_TGZ}.sha256"
    FETCH_FROM="$url"
}

# The target's bundle into BUNDLE_TGZ / BUNDLE_SHA / BUNDLE_FROM: DEPLOY_BUNDLE
# if it is set, else the cache, else the release. Returns 1 when none is to be
# had. A DEPLOY_BUNDLE that cannot be used stops the deploy, because an operator
# who names a file means that file and not whatever else could be found.
BUNDLE_TGZ=""
BUNDLE_SHA=""
BUNDLE_FROM=""
bundle_obtain() {
    local name="finance-stack-${TARGET}.tar.gz"
    if [ -n "${DEPLOY_BUNDLE:-}" ]; then
        [ -f "$DEPLOY_BUNDLE" ] || die "DEPLOY_BUNDLE=${DEPLOY_BUNDLE} does not exist"
        [ "$(basename "$DEPLOY_BUNDLE")" = "$name" ] \
            || die "DEPLOY_BUNDLE is $(basename "$DEPLOY_BUNDLE"), but the target is ${TARGET} — expected ${name}"
        [ -f "${DEPLOY_BUNDLE}.sha256" ] \
            || die "DEPLOY_BUNDLE has no ${name}.sha256 beside it — copy both files from the release, so the bundle can be verified"
        bundle_checksum_ok "$DEPLOY_BUNDLE" "${DEPLOY_BUNDLE}.sha256" "$name" \
            || die "${DEPLOY_BUNDLE} fails its checksum — nothing has been changed"
        BUNDLE_TGZ="$DEPLOY_BUNDLE"
        BUNDLE_SHA="${DEPLOY_BUNDLE}.sha256"
        BUNDLE_FROM="DEPLOY_BUNDLE"
        return 0
    fi
    bundle_fetch "$TARGET" 1 || return 1
    BUNDLE_TGZ="$FETCH_TGZ"
    BUNDLE_SHA="$FETCH_SHA"
    BUNDLE_FROM="$FETCH_FROM"
}

# A command that prints FILE from VERSION's bundle TGZ: from the file itself if
# it outlives this run, otherwise from the URL it was downloaded from.
bundle_show_cmd() {
    local tgz="$1" from="$2" version="$3" file="$4"
    case "$tgz" in
        "$WORK_DIR"/*) printf 'curl -fsSL %s | tar -xzO finance-stack-%s/%s' "$from" "$version" "$file" ;;
        *)             printf 'tar -xzOf %s finance-stack-%s/%s' "$tgz" "$version" "$file" ;;
    esac
}

# docker compose against the target's compose.yml while it is still in the
# scratch directory, read together with any compose.override.yml as Compose
# will read it once installed: for validating it, and for the pull.
OVERRIDE_ARGS=()
compose_staged() {
    docker compose --project-directory "$PWD" --env-file "${PWD}/${ENV_FILE}" \
        -f "${STAGE_DIR}/compose.yml" ${OVERRIDE_ARGS[@]+"${OVERRIDE_ARGS[@]}"} "$@"
}

# Paths deploy.sh never installs over, whatever a bundle carries: the operator's
# own configuration and data, and this script's state.
never_touched() {
    case "$1" in
        .env|compose.override.yml|compose.override.yaml) return 0 ;;
        imports|imports/*|importer/parsers|importer/parsers/*|backups|backups/*) return 0 ;;
        "$STATE_FILE"|"$BUNDLE_CACHE"|"$BUNDLE_CACHE"/*|"$BUNDLE_BACKUP"|"$BUNDLE_BACKUP"/*) return 0 ;;
    esac
    return 1
}

# What installing the target's bundle will do, decided before anything is
# written. PLAN_ACTIONS holds "<action> <path>": install (the bundle's file
# replaces this one), restamp (an edited compose.yml the release leaves alone
# keeps its edits and moves its stamp) or dist (an edited file is kept and the
# bundle's is written beside it as <path>.dist). PLAN_PATHS is what those write.
PLAN_ACTIONS=()
PLAN_PATHS=()
PLAN_NOTES=()
CONFLICTS=()
COMPOSE_CHANGES=0
BASELINE_DIR=""
BASELINE_TGZ=""
BASELINE_FROM=""
BASELINE_VERSION=""
BASELINE_WHY=""

plan_add() {
    PLAN_ACTIONS+=("$1 $2")
    if [ "$1" = "dist" ]; then
        PLAN_PATHS+=("$2.dist")
    else
        PLAN_PATHS+=("$2")
    fi
}

# The bundle the installed compose.yml came from, unpacked, so an edited file can
# be told apart from an unedited one. The cache comes first even when that is
# the target's own version: it holds the bundle deploy.sh actually installed,
# which is the witness that matters if the one being deployed differs. Then the
# target's bundle, for its own version, or a download. Leaves BASELINE_DIR
# empty, and BASELINE_WHY saying why, when there is none.
bundle_baseline() {
    local stamp
    stamp="$(compose_stamp compose.yml)"
    if [ -z "$stamp" ]; then
        BASELINE_WHY="it carries no bundle stamp, so a deploy.sh older than #347 installed it"
        return 1
    fi
    if [ "$stamp" = "$TARGET" ] && [ ! -f "${BUNDLE_CACHE}/finance-stack-${stamp}.tar.gz" ]; then
        BASELINE_DIR="$STAGE_DIR"
        BASELINE_VERSION="$TARGET"
        return 0
    fi
    if ! bundle_fetch "$stamp" 0; then
        BASELINE_WHY="the ${stamp} bundle it came from could not be fetched to compare it against"
        return 1
    fi
    if ! BASELINE_DIR="$(bundle_unpack "$FETCH_TGZ" "$stamp" "${WORK_DIR}/baseline")"; then
        BASELINE_DIR=""
        BASELINE_WHY="the ${stamp} bundle it came from could not be unpacked"
        return 1
    fi
    BASELINE_TGZ="$FETCH_TGZ"
    BASELINE_FROM="$FETCH_FROM"
    BASELINE_VERSION="$stamp"
}

plan_compose() {
    local new="${STAGE_DIR}/compose.yml" base="${BASELINE_DIR:+${BASELINE_DIR}/compose.yml}"
    if same_file compose.yml "$new"; then
        return 0
    fi
    if same_compose compose.yml "$new"; then
        # Only the stamp differs: the release leaves the stack definition alone.
        plan_add install compose.yml
        return 0
    fi
    if [ -z "$base" ] || [ ! -f "$base" ]; then
        plan_add install compose.yml
        COMPOSE_CHANGES=1
        PLAN_NOTES+=("compose.yml was replaced without checking it for local edits, because ${BASELINE_WHY}. The previous copy is in ${BUNDLE_BACKUP}/compose.yml — if you had changed it, move those changes into compose.override.yml.")
        return 0
    fi
    if same_compose compose.yml "$base"; then
        plan_add install compose.yml
        COMPOSE_CHANGES=1
        return 0
    fi
    # Edited here. Kept if the release does not change it either…
    if same_compose "$base" "$new"; then
        if [ "$(compose_stamp compose.yml)" != "$TARGET" ]; then
            plan_add restamp compose.yml
        fi
        PLAN_NOTES+=("compose.yml has local edits. ${TARGET} does not change it, so they were kept, but the next release that does will stop until they are moved into compose.override.yml.")
        return 0
    fi
    # …and otherwise the deploy stops: dropping the edits silently is #347 again.
    CONFLICTS+=("compose.yml")
}

# The Caddyfile, which the docs tell operators to edit (`tls internal`, an
# ACME email) and which has nothing like compose.override.yml: an edited copy is
# kept, and the release's is written beside it.
plan_conffile() {
    local rel="$1" new="${STAGE_DIR}/$1" base="${BASELINE_DIR:+${BASELINE_DIR}/$1}"
    if [ ! -e "$rel" ]; then
        plan_add install "$rel"
        return 0
    fi
    if same_file "$rel" "$new"; then
        return 0
    fi
    if [ -n "$base" ] && [ -f "$base" ]; then
        if same_file "$rel" "$base"; then
            plan_add install "$rel"
            return 0
        fi
        if same_file "$base" "$new"; then
            return 0     # edited here, and the release leaves it alone
        fi
    fi
    plan_add dist "$rel"
    PLAN_NOTES+=("${rel} differs from the one ${TARGET} ships, so it was kept and the release's copy written beside it. Compare them and merge what you need: diff ${rel} ${rel}.dist")
}

bundle_plan() {
    local rel
    bundle_baseline || true
    while IFS= read -r -d '' rel; do
        rel="${rel#./}"
        if never_touched "$rel"; then
            continue
        fi
        case "$rel" in
            deploy.sh) ;;                     # replaced at commit, if at all
            compose.yml) plan_compose ;;
            caddy/Caddyfile) plan_conffile "$rel" ;;
            *)
                if [ ! -e "$rel" ] || ! same_file "$rel" "${STAGE_DIR}/${rel}"; then
                    plan_add install "$rel"
                    if [ "$rel" = "finance-stack.service" ] && [ -e "$rel" ]; then
                        PLAN_NOTES+=("finance-stack.service changed in ${TARGET}. If you installed it, copy it again: sudo cp finance-stack.service /etc/systemd/system/ && sudo systemctl daemon-reload")
                    fi
                fi
                ;;
        esac
    done < <(cd "$STAGE_DIR" && find . -type f -print0 | LC_ALL=C sort -z)
}

# The NAME= and `# NAME=` keys of an .env.example, extracted the way
# scripts/check-deploy-parity.sh does it.
template_names() {
    grep -oE '^#? ?[A-Z_][A-Z0-9_]*=' "$1" | tr -d '# =' | LC_ALL=C sort -u
}

template_active() { grep -qE "^${2}=" "$1"; }

# What the target's .env.example adds, drops and changes compared with the one
# already here — not with .env, where optional keys stay commented out for good
# and would be reported on every run. Prints key names and template values only,
# never a value from .env. Stops the deploy when the release adds a key its
# template sets to a `changeme` placeholder, which by the template's convention
# is a new required value, and .env does not have it.
TEMPLATE_CHANGES=0
template_report() {
    local old=".env.example" new="${STAGE_DIR}/.env.example" name oldv newv line
    local -a added=() removed=() changed=() required=()
    if [ ! -f "$old" ] || [ ! -f "$new" ]; then
        return 0
    fi

    while IFS= read -r name; do
        [ -n "$name" ] || continue
        added+=("$name")
        if template_active "$new" "$name" && ! env_has "$name"; then
            case "$(env_file_get "$new" "$name")" in
                changeme*) required+=("$name") ;;
            esac
        fi
    done < <(LC_ALL=C comm -13 <(template_names "$old") <(template_names "$new"))

    while IFS= read -r name; do
        if [ -n "$name" ] && env_has "$name"; then
            removed+=("$name")
        fi
    done < <(LC_ALL=C comm -23 <(template_names "$old") <(template_names "$new"))

    while IFS= read -r name; do
        [ -n "$name" ] && [ "$name" != "APP_VERSION" ] || continue
        template_active "$old" "$name" && template_active "$new" "$name" || continue
        oldv="$(env_file_get "$old" "$name")"
        newv="$(env_file_get "$new" "$name")"
        [ "$oldv" != "$newv" ] || continue
        env_has "$name" && [ "$(env_get "$name")" = "$oldv" ] || continue
        changed+=("${name}: '${oldv}' → '${newv}'")
    done < <(LC_ALL=C comm -12 <(template_names "$old") <(template_names "$new"))

    TEMPLATE_CHANGES=$(( ${#added[@]} + ${#removed[@]} + ${#changed[@]} ))
    if [ "$TEMPLATE_CHANGES" -gt 0 ]; then
        log "${TARGET}'s .env.example differs from the one here:"
        if [ "${#added[@]}" -gt 0 ]; then
            log "  new:              ${added[*]} — described in the new .env.example"
        fi
        for line in ${changed[@]+"${changed[@]}"}; do
            log "  default changed:  ${line} — your ${ENV_FILE} still has the old default"
        done
        if [ "${#removed[@]}" -gt 0 ]; then
            log "  no longer read:   ${removed[*]} — still set in your ${ENV_FILE}"
        fi
    fi

    if [ "${#required[@]}" -gt 0 ]; then
        warn "${TARGET} needs ${required[*]} in ${ENV_FILE}: its .env.example sets them to a changeme placeholder, which marks a value you must supply. Read what each is for with:"
        warn "  $(bundle_show_cmd "$BUNDLE_TGZ" "$BUNDLE_FROM" "$TARGET" .env.example)"
        die "${ENV_FILE} lacks ${required[*]}, which ${TARGET} requires — add them, then re-run. Nothing has been changed."
    fi
}

# Copies SRC over DEST the way pin_version writes .env — a temp file beside it,
# then mv — so nothing ever reads half a file and an interrupted install leaves
# the previous file whole.
install_file() {
    local src="$1" dest="$2" mode="$3" tmp
    tmp="${dest}.deploy.tmp"
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$tmp" && chmod "$mode" "$tmp" && mv -f "$tmp" "$dest"
}

shipped_mode() {
    if [ -x "$1" ]; then
        printf '755'
    else
        printf '644'
    fi
}

snapshot_take() {
    local path
    mkdir -p "$SNAPSHOT_DIR"
    for path in "$@"; do
        if [ -e "$path" ]; then
            mkdir -p "${SNAPSHOT_DIR}/$(dirname "$path")"
            cp -p "$path" "${SNAPSHOT_DIR}/${path}"
            SNAPSHOT_PATHS+=("$path")
        else
            SNAPSHOT_NEW+=("$path")
        fi
    done
}

# Puts every snapshotted file back and removes the ones the install created.
snapshot_restore() {
    local path failed=0
    for path in ${SNAPSHOT_PATHS[@]+"${SNAPSHOT_PATHS[@]}"}; do
        install_file "${SNAPSHOT_DIR}/${path}" "$path" "$(stat -c '%a' "${SNAPSHOT_DIR}/${path}")" || failed=1
    done
    for path in ${SNAPSHOT_NEW[@]+"${SNAPSHOT_NEW[@]}"}; do
        rm -f "$path" || failed=1
    done
    FILES_DIRTY=0
    return "$failed"
}

# Keeps an edited compose.yml's content and moves only its stamp to TARGET, for
# a release that does not change the file.
restamp_compose() {
    local tmp="compose.yml.deploy.tmp"
    sed -E "s/^# finance-stack bundle: .*/# finance-stack bundle: ${TARGET}/" compose.yml > "$tmp" \
        && chmod --reference=compose.yml "$tmp" \
        && mv -f "$tmp" compose.yml
}

bundle_install() {
    local entry action rel dir
    # Directories the bundle ships that are missing here — never removed again.
    while IFS= read -r -d '' dir; do
        dir="${dir#./}"
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir" || return 1
        fi
    done < <(cd "$STAGE_DIR" && find . -mindepth 1 -type d -print0)

    for entry in "${PLAN_ACTIONS[@]}"; do
        action="${entry%% *}"
        rel="${entry#* }"
        case "$action" in
            install) install_file "${STAGE_DIR}/${rel}" "$rel" "$(shipped_mode "${STAGE_DIR}/${rel}")" || return 1 ;;
            restamp) restamp_compose || return 1 ;;
            dist)    install_file "${STAGE_DIR}/${rel}" "${rel}.dist" 644 || return 1 ;;
        esac
        log "  ${action} ${rel}"
    done
}

# Copies the verified TGZ and its SHA into the cache, unless that is where they
# already are.
cache_bundle() {
    local tgz="$1" sha="$2" name
    name="$(basename "$tgz")"
    if [ "$(dirname "$tgz")" = "$BUNDLE_CACHE" ]; then
        return 0
    fi
    mkdir -p "$BUNDLE_CACHE"
    if cp "$tgz" "${BUNDLE_CACHE}/${name}.tmp" \
       && cp "$sha" "${BUNDLE_CACHE}/${name}.sha256.tmp" \
       && mv -f "${BUNDLE_CACHE}/${name}.tmp" "${BUNDLE_CACHE}/${name}" \
       && mv -f "${BUNDLE_CACHE}/${name}.sha256.tmp" "${BUNDLE_CACHE}/${name}.sha256"; then
        return 0
    fi
    warn "could not keep ${name} in ${BUNDLE_CACHE}/ — a later rollback to it will need the network"
}

# Keeps the bundles for TARGET and PREV, as prune_images keeps their images, so
# a rollback still works with GitHub unreachable.
prune_bundles() {
    local tgz version
    for tgz in "${BUNDLE_CACHE}"/finance-stack-*.tar.gz; do
        [ -e "$tgz" ] || continue
        version="$(basename "$tgz" .tar.gz)"
        version="${version#finance-stack-}"
        [ "$version" = "$TARGET" ] && continue
        [ -n "$PREV" ] && [ "$version" = "$PREV" ] && continue
        if rm -f "$tgz" "${tgz}.sha256"; then
            log "pruned superseded bundle $(basename "$tgz")"
        fi
    done
}

# Replaces this script with the target bundle's once the deploy has committed.
# The mv swaps the directory entry while bash keeps reading the file it opened,
# so the rest of this run is unaffected and the next run gets the new script.
# Forward only: a deliberate rollback keeps the newer script, so the next
# upgrade is still run by a script that refreshes the stack; and a checkout's
# copy is never replaced.
SELF_UPDATED=""
self_update() {
    local staged="${STAGE_DIR}/deploy.sh" theirs
    if [ ! -f "$staged" ] || same_file "$staged" deploy.sh; then
        return 0
    fi
    if [ "$DEPLOY_SCRIPT_VERSION" = "unreleased" ]; then
        log "not replacing deploy.sh — this one is a checkout's working copy"
        return 0
    fi
    theirs="$(sed -nE 's/^DEPLOY_SCRIPT_VERSION="([0-9A-Za-z.+-]+)"$/\1/p' "$staged" | head -n1)"
    if [ -z "$theirs" ] || [ "$theirs" = "unreleased" ] || ! version_ge "$theirs" "$DEPLOY_SCRIPT_VERSION"; then
        log "keeping this deploy.sh (${DEPLOY_SCRIPT_VERSION}) — the ${TARGET} bundle's is older"
        return 0
    fi
    mkdir -p "$BUNDLE_BACKUP"
    cp -p deploy.sh "${BUNDLE_BACKUP}/deploy.sh" || true
    if install_file "$staged" deploy.sh 755; then
        SELF_UPDATED="$theirs"
    else
        warn "could not replace deploy.sh with ${TARGET}'s — the deploy itself succeeded; replace it by hand: $(bundle_show_cmd "$BUNDLE_TGZ" "$BUNDLE_FROM" "$TARGET" deploy.sh) > deploy.sh"
    fi
}

# A plain `up -d` leaves the services of an inactive profile exactly as they
# are: running, on whatever definition started them. So once the app is
# healthy, any running bi / errors / edge service is re-applied on the deployed
# definition — otherwise a Metabase bump reaches compose.yml and never the
# container. A failure here is a warning, not a rollback: the app is committed.
OPTIONAL_REAPPLIED=()
OPTIONAL_FAILED=()
converge_optional_profiles() {
    local profile defaults
    local -a gated running
    defaults="$(docker compose config --services 2>/dev/null | LC_ALL=C sort)" || return 0
    while IFS= read -r profile; do
        [ -n "$profile" ] || continue
        mapfile -t gated < <(LC_ALL=C comm -13 <(printf '%s\n' "$defaults") \
            <(docker compose --profile "$profile" config --services 2>/dev/null | LC_ALL=C sort) \
            | sed '/^[[:space:]]*$/d')
        [ "${#gated[@]}" -gt 0 ] || continue
        mapfile -t running < <(docker compose --profile "$profile" ps --status running --services "${gated[@]}" 2>/dev/null \
            | sed '/^[[:space:]]*$/d')
        [ "${#running[@]}" -gt 0 ] || continue
        log "re-applying running --profile ${profile} services on the deployed definition: ${running[*]}"
        if docker compose --profile "$profile" up -d --no-deps "${running[@]}"; then
            OPTIONAL_REAPPLIED+=("${running[@]}")
        else
            warn "could not re-apply ${running[*]} — the app is deployed; check with: docker compose --profile ${profile} ps"
            OPTIONAL_FAILED+=("${running[@]}")
        fi
    done < <(docker compose config --profiles 2>/dev/null)
}

# ------------------------------------------------------------
# 1. Arguments
# ------------------------------------------------------------
case "${1:-}" in
    -h|--help)
        # The file header, to the first line that is not a comment — so it cannot
        # drift out of step with the header's length.
        awk 'NR>1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$SELF"
        exit 0
        ;;
esac

[ "$#" -le 1 ] || die "usage: ./deploy.sh [X.Y.Z]"
[ -f "$ENV_FILE" ] || die "${ENV_FILE} not found in $(pwd) — copy .env.example to .env and fill it in (see README.md)"

TARGET="${1:-}"
TARGET="${TARGET#v}"                      # accept the tag form too
if [ -z "$TARGET" ]; then
    TARGET="$(env_get APP_VERSION)"
    [ -n "$TARGET" ] || die "no version given and APP_VERSION is not set in ${ENV_FILE}"
    log "no version argument — using APP_VERSION=${TARGET} from ${ENV_FILE}"
fi

# Validated before it can reach awk, a tag reference, a file name or a URL.
if ! printf '%s' "$TARGET" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'; then
    die "'${TARGET}' is not a version — expected X.Y.Z"
fi

# ------------------------------------------------------------
# 2. Preflight
# ------------------------------------------------------------
log "preflight… (deploy.sh ${DEPLOY_SCRIPT_VERSION})"

command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH"
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is not available (\`docker compose version\` failed)"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon — is it running, and does this user have access?"
command -v curl >/dev/null 2>&1 || die "curl is required for the health gate"
if [ "${DEPLOY_SKIP_BUNDLE:-0}" != "1" ]; then
    for tool in tar sha256sum; do
        command -v "$tool" >/dev/null 2>&1 \
            || die "${tool} is required to verify and unpack the release bundle (or set DEPLOY_SKIP_BUNDLE=1)"
    done
fi
[ -f compose.yml ] || die "compose.yml not found in $(pwd)"

for var in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB AUTH_SECRET \
           FINANCE_APP_DB_PASSWORD FINANCE_IMPORTER_DB_PASSWORD FINANCE_BI_DB_PASSWORD \
           IMAGE_REGISTRY; do
    require_env_var "$var"
done

# MB_DB_PASS is deliberately not required: empty is meaningful there — it tells
# the migrate job to skip Metabase provisioning entirely (#225). A placeholder
# left in place is still a misconfiguration.
MB_DB_PASS_VALUE="$(env_get MB_DB_PASS)"
case "$MB_DB_PASS_VALUE" in
    changeme*) die "MB_DB_PASS is still a placeholder in ${ENV_FILE} — set a real value, or empty it to skip Metabase entirely" ;;
esac

IMAGE_REGISTRY="$(env_get IMAGE_REGISTRY)"
FINANCE_APP_DB="$(env_get FINANCE_APP_DB)"
FINANCE_APP_DB="${FINANCE_APP_DB:-Finances}"

command -v jq >/dev/null 2>&1 || log "jq not found — reading build.version with a text extraction instead"

log "✓ preflight passed"

# ------------------------------------------------------------
# 3. Record state: what we can roll back to, and whether this is a first install
# ------------------------------------------------------------
PREV=""
if [ -f "$STATE_FILE" ]; then
    PREV="$(tr -d '[:space:]' < "$STATE_FILE")"
fi
if [ -z "$PREV" ]; then
    # An install that predates this script has no state file but is still an
    # upgrade, not a first install — .env's current pin is the rollback target.
    PREV="$(env_get APP_VERSION)"
fi

POSTGRES_VOLUME="$(compose_project_name)_postgres_data"

FIRST_INSTALL=0
if ! docker volume inspect "$POSTGRES_VOLUME" >/dev/null 2>&1; then
    FIRST_INSTALL=1
fi

if [ "$FIRST_INSTALL" -eq 1 ]; then
    log "no ${POSTGRES_VOLUME} volume — this is a first install"
else
    log "current deployment: ${PREV:-unknown} → target: ${TARGET}"
fi

# ------------------------------------------------------------
# 4. The target's bundle (#347): fetched, verified, unpacked into the scratch
#    directory, and what installing it would change decided. Nothing here is
#    written until step 7.
# ------------------------------------------------------------
STAGE_DIR=""
FILES_SUMMARY=""
INSTALLED_STAMP="$(compose_stamp compose.yml)"
if [ -n "$INSTALLED_STAMP" ]; then
    INSTALLED_DESC="from the ${INSTALLED_STAMP} bundle"
else
    INSTALLED_DESC="unstamped — from a bundle older than #347"
fi
for override in compose.override.yml compose.override.yaml; do
    if [ -f "$override" ]; then
        OVERRIDE_ARGS+=(-f "$override")
    fi
done

if [ "${DEPLOY_SKIP_BUNDLE:-0}" = "1" ]; then
    log "DEPLOY_SKIP_BUNDLE=1 — deploying with the files already here, not the ${TARGET} bundle's"
    if [ "$INSTALLED_STAMP" != "$TARGET" ]; then
        warn "compose.yml here is ${INSTALLED_DESC}, not ${TARGET}'s — the ${TARGET} images will run on that stack definition"
    fi
    FILES_SUMMARY="not refreshed (DEPLOY_SKIP_BUNDLE=1)"
elif [ "$INSTALLED_STAMP" = "unreleased" ]; then
    log "compose.yml is a checkout's working copy (unreleased), so it is not refreshed from a release — pack a bundle with scripts/pack-bundle.sh to rehearse an upgrade"
    FILES_SUMMARY="not refreshed (a checkout's working copy)"
elif bundle_obtain; then
    log "bundle: finance-stack-${TARGET}.tar.gz from ${BUNDLE_FROM} — checksum OK"
    STAGE_DIR="$(bundle_unpack "$BUNDLE_TGZ" "$TARGET" "${WORK_DIR}/stage")" \
        || die "finance-stack-${TARGET}.tar.gz is not a usable ${TARGET} bundle — nothing has been changed"

    # The project name prefixes every volume. A compose.yml that changed it
    # would bring the stack up on new, empty volumes.
    STAGED_PROJECT="$(compose_project_name "${STAGE_DIR}/compose.yml")"
    [ "$STAGED_PROJECT" = "$(compose_project_name)" ] \
        || die "${TARGET}'s compose.yml names the project '${STAGED_PROJECT}', not '$(compose_project_name)' — every volume would change with it. Nothing has been changed."

    # Rendered as Compose will render it once installed, override included: a
    # file this host's Compose cannot read, or an override that no longer fits,
    # fails here instead of at `up`.
    if ! APP_VERSION="$TARGET" compose_staged config -q; then
        die "${TARGET}'s compose.yml does not validate here (together with compose.override.yml, if you have one) — nothing has been changed. A Compose plugin older than the release needs is the usual cause: docker compose version"
    fi

    bundle_plan
    if [ "${#CONFLICTS[@]}" -gt 0 ]; then
        warn "compose.yml has been edited here, and ${TARGET} changes it too, so installing the release's copy would silently drop those edits."
        warn "See what was edited:"
        warn "  $(bundle_show_cmd "$BASELINE_TGZ" "$BASELINE_FROM" "$BASELINE_VERSION" compose.yml) | diff - compose.yml"
        warn "Move the edits into compose.override.yml — Compose reads it on its own and deploy.sh never touches it —"
        warn "then put the shipped copy back and re-run:"
        warn "  $(bundle_show_cmd "$BASELINE_TGZ" "$BASELINE_FROM" "$BASELINE_VERSION" compose.yml) > compose.yml"
        warn "  ./deploy.sh ${TARGET}"
        die "compose.yml conflicts with the ${TARGET} release — nothing has been changed"
    fi
    template_report

    if [ "${#PLAN_ACTIONS[@]}" -eq 0 ]; then
        log "✓ the files here already match the ${TARGET} bundle"
        FILES_SUMMARY="already match the ${TARGET} bundle"
    else
        log "the ${TARGET} bundle will update: ${PLAN_PATHS[*]}"
    fi
elif [ "$INSTALLED_STAMP" = "$TARGET" ]; then
    warn "could not get the ${TARGET} bundle — compose.yml here is already ${TARGET}'s, so deploying with the files already here"
    FILES_SUMMARY="${TARGET}'s by their stamp (the bundle could not be fetched to compare)"
else
    warn "could not get finance-stack-${TARGET}.tar.gz from ${BUNDLE_CACHE}/ or ${RELEASE_URL}/v${TARGET}/,"
    warn "and compose.yml here is ${INSTALLED_DESC}, not ${TARGET}'s."
    warn "Deploying anyway would run the ${TARGET} images on that older stack definition. Instead:"
    warn "  • check the version exists: https://github.com/aellington89/finance-stack/releases"
    warn "  • offline? Copy finance-stack-${TARGET}.tar.gz and its .sha256 here, then run"
    warn "      DEPLOY_BUNDLE=./finance-stack-${TARGET}.tar.gz ./deploy.sh ${TARGET}"
    warn "  • to deploy on the files already here regardless: DEPLOY_SKIP_BUNDLE=1 ./deploy.sh ${TARGET}"
    die "no ${TARGET} bundle — nothing has been changed"
fi

# ------------------------------------------------------------
# 5. Pull first — a bad or nonexistent version fails here, before anything
#    running is touched and before .env is written. From the target's
#    compose.yml when there is one, so new third-party images come too.
# ------------------------------------------------------------
if [ "${DEPLOY_SKIP_PULL:-0}" = "1" ]; then
    log "DEPLOY_SKIP_PULL=1 — skipping the pull, using images already present locally"
else
    log "pulling images for ${TARGET}…"
    PULL_OK=1
    if [ -n "$STAGE_DIR" ]; then
        APP_VERSION="$TARGET" compose_staged pull || PULL_OK=0
    else
        APP_VERSION="$TARGET" docker compose pull || PULL_OK=0
    fi
    if [ "$PULL_OK" -eq 0 ]; then
        die "could not pull the images for ${TARGET} — nothing has been changed. Check the version exists: https://github.com/aellington89/finance-stack/releases"
    fi
    log "✓ images for ${TARGET} are present"
fi

# ------------------------------------------------------------
# 6. Pre-upgrade backup gate
# ------------------------------------------------------------
DUMP_HOST=""
DUMP_CONTAINER=""

wait_for_postgres() {
    local cid elapsed=0 status
    cid="$(docker compose ps -q postgres 2>/dev/null || true)"
    [ -n "$cid" ] || return 1
    while :; do
        status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo unknown)"
        [ "$status" = "healthy" ] && return 0
        [ "$elapsed" -ge 120 ] && return 1
        sleep 3
        elapsed=$((elapsed + 3))
    done
}

if [ "$FIRST_INSTALL" -eq 1 ]; then
    log "skipping the backup gate — there is no database to dump yet"
# Gated on the state file, not on PREV alone: an install that predates this
# script has no record of having *verified* at that version, so its first run
# takes one safety dump rather than trusting .env. And only when compose.yml is
# not about to change (#347): a new postgres image restarts the database.
elif [ -f "$STATE_FILE" ] && [ "$TARGET" = "$PREV" ] && [ "$COMPOSE_CHANGES" -eq 0 ]; then
    log "skipping the backup gate — ${TARGET} is already deployed, so no schema change can occur (converging only)"
else
    if [ -f "$STATE_FILE" ] && [ "$TARGET" = "$PREV" ]; then
        log "${TARGET} is already deployed, but this run changes compose.yml, so the dump runs anyway"
    fi
    log "taking a pre-upgrade dump — this gates the deploy, and migrate does not run until it lands"

    # A stopped stack is a normal state to upgrade from (systemctl stop, or a
    # host reboot with the unit disabled). Bring postgres up on its own, at the
    # OLD version, so the dump can be taken.
    if [ -z "$(docker compose ps --status running -q postgres 2>/dev/null || true)" ]; then
        log "postgres is not running — starting it (without dependents) so the dump can be taken"
        docker compose up -d --no-deps postgres || die "could not start postgres for the pre-upgrade dump"
    fi
    wait_for_postgres || die "postgres did not become healthy within 120s — refusing to deploy without a dump"

    MARKER="${WORK_DIR}/marker"
    touch "$MARKER"

    # --no-deps: pg-backup depends on migrate completing, and `run` honours
    # depends_on. --entrypoint: the service entrypoint is a sleep loop, so a
    # trailing command would become its $0 rather than the program to run.
    # -T: no pseudo-TTY, so this behaves identically under systemd and in CI.
    if ! docker compose run --rm -T --no-deps --entrypoint /scripts/backup.sh pg-backup; then
        die "the pre-upgrade dump FAILED — aborting. Nothing has been changed; the stack is still running ${PREV:-its current version}."
    fi

    # A zero exit that produced no file is still a failed gate.
    DUMP_HOST="$(find "$BACKUP_DIR_HOST" -maxdepth 1 -name "${FINANCE_APP_DB}_*.dump" -newer "$MARKER" -printf '%T@ %p\n' 2>/dev/null \
                   | sort -rn | head -n1 | cut -d' ' -f2- || true)"
    [ -n "$DUMP_HOST" ] || die "the dump reported success but no new ${FINANCE_APP_DB} dump appeared in ${BACKUP_DIR_HOST}/ — aborting"

    DUMP_CONTAINER="${BACKUP_DIR_CONTAINER}/$(basename "$DUMP_HOST")"
    log "✓ pre-upgrade dump: ${DUMP_HOST}"
fi

# ------------------------------------------------------------
# 7. Pin .env and install the bundle's files — the point where this run first
#    writes here, with everything it replaces snapshotted beforehand.
# ------------------------------------------------------------
if [ "${#PLAN_ACTIONS[@]}" -gt 0 ]; then
    snapshot_take "${PLAN_PATHS[@]}"
fi
pin_version "$TARGET"
if [ "${#PLAN_ACTIONS[@]}" -gt 0 ]; then
    log "installing the ${TARGET} bundle's files…"
    FILES_DIRTY=1
    if ! bundle_install; then
        snapshot_restore || true
        cp "$ENV_PRISTINE" "$ENV_FILE"
        ENV_DIRTY=0
        die "could not install the ${TARGET} bundle's files — the previous files and ${ENV_FILE} are back, and nothing was started"
    fi
fi

# ------------------------------------------------------------
# 8. Apply, 9. health-gate
# ------------------------------------------------------------
# --remove-orphans: a service the new compose.yml no longer defines is stopped
# rather than left running on a definition nothing describes any more. Services
# of an inactive profile are not orphans, so a running Metabase is left alone.
log "applying — postgres → migrate → app/importer, sequenced by compose"
APPLY_OK=1
docker compose up -d --remove-orphans || APPLY_OK=0

HEALTH_OK=0
if [ "$APPLY_OK" -eq 1 ]; then
    if poll_health "$TARGET"; then
        HEALTH_OK=1
    fi
fi

# ------------------------------------------------------------
# 10. Rollback on failure
# ------------------------------------------------------------
if [ "$HEALTH_OK" -eq 0 ]; then
    if [ "$APPLY_OK" -eq 0 ]; then
        warn "\`docker compose up -d\` failed for ${TARGET}"
    else
        warn "${TARGET} did not reach a healthy /api/health reporting version ${TARGET} within ${HEALTH_TIMEOUT}s"
    fi
    dump_diagnostics

    # Same version and no files changed: there is nothing different to go back
    # to. A same-version run that did install new files (#347) rolls them back
    # below like any upgrade.
    if [ -z "$PREV" ] || { [ "$PREV" = "$TARGET" ] && [ "$FILES_DIRTY" -eq 0 ]; }; then
        # A first install has nothing to roll back to. Leave it up: the logs
        # above are the diagnosis, and tearing it down destroys the evidence.
        if [ "$FILES_DIRTY" -eq 1 ]; then
            snapshot_restore || true
        fi
        cp "$ENV_PRISTINE" "$ENV_FILE" 2>/dev/null || true
        ENV_DIRTY=0
        die "there is no previous version to roll back to. The stack has been left up for inspection — read the migrate log above first, since finance-app does not start until migrate exits 0."
    fi

    warn "rolling back to ${PREV}"
    ROLLBACK_OK=1
    FILES_RESTORED=0
    if [ "$FILES_DIRTY" -eq 1 ]; then
        if snapshot_restore; then
            FILES_RESTORED=1
        else
            # Keep the previous files somewhere this run will not delete.
            rm -rf "$BUNDLE_BACKUP"
            cp -a "$SNAPSHOT_DIR" "$BUNDLE_BACKUP" || true
            warn "could not put every file back — the previous copies are in ${BUNDLE_BACKUP}/"
            ROLLBACK_OK=0
        fi
    fi
    pin_version "$PREV"

    docker compose up -d --remove-orphans || ROLLBACK_OK=0
    if [ "$ROLLBACK_OK" -eq 1 ]; then
        poll_health "$PREV" || ROLLBACK_OK=0
    fi

    echo
    echo "============================================================"
    if [ "$ROLLBACK_OK" -eq 1 ]; then
        echo "ROLLED BACK to ${PREV}. The application is healthy again."
    else
        echo "ROLLBACK FAILED. ${PREV} is pinned in ${ENV_FILE} but did not come up healthy."
    fi
    if [ "$FILES_RESTORED" -eq 1 ]; then
        echo "The files this run installed from the ${TARGET} bundle were put back as well."
    fi
    ENV_DIRTY=0

    echo
    echo "THE ROLLBACK RESTORED THE APPLICATION, NOT THE DATABASE."
    echo "If ${TARGET} carried a schema migration, ${PREV} may not run against the"
    echo "schema now on disk — there are no down migrations. Check the release's"
    echo "**Migration:** marker; if it reads 'breaking', restore the pre-upgrade dump:"
    echo
    if [ -n "$DUMP_CONTAINER" ]; then
        echo "  docker compose exec pg-backup /scripts/restore.sh --force ${DUMP_CONTAINER} ${FINANCE_APP_DB}"
        echo
        echo "  (host path: ${DUMP_HOST})"
        echo "  If pg-backup is not running, use:"
        echo "  docker compose run --rm -T --no-deps --entrypoint /scripts/restore.sh pg-backup --force ${DUMP_CONTAINER} ${FINANCE_APP_DB}"
    else
        echo "  No pre-upgrade dump was taken on this run, so there is nothing to restore"
        echo "  from here. The newest scheduled dump is in ${BACKUP_DIR_HOST}/."
    fi
    echo "============================================================"

    [ "$ROLLBACK_OK" -eq 1 ] && exit 2
    exit 3
fi

# ------------------------------------------------------------
# 11. Commit
# ------------------------------------------------------------
printf '%s\n' "$TARGET" > "$STATE_FILE"
ENV_DIRTY=0
FILES_DIRTY=0

# Prune superseded images, keeping the target AND the rollback target — so a
# rollback still works with the registry unreachable. Runs only when the version
# actually moved: on a first install or a same-version convergence nothing has
# been superseded, and removing other tags there would be deleting images this
# run has no opinion about.
prune_images() {
    local svc repo ref tag
    for svc in app migrate importer backup; do
        repo="${IMAGE_REGISTRY}/finance-${svc}"
        while IFS= read -r ref; do
            [ -n "$ref" ] || continue
            tag="${ref##*:}"
            [ "$tag" = "<none>" ] && continue
            [ "$tag" = "$TARGET" ] && continue
            [ -n "$PREV" ] && [ "$tag" = "$PREV" ] && continue
            if docker image rm "$ref" >/dev/null 2>&1; then
                log "pruned superseded image ${ref}"
            fi
        done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repo" 2>/dev/null || true)
    done
}

# The bundle side of the commit (#347): keep what this run replaced, cache the
# verified bundles a later rollback would need, and update this script.
if [ -n "$STAGE_DIR" ]; then
    if [ "${#SNAPSHOT_PATHS[@]}" -gt 0 ]; then
        rm -rf "${BUNDLE_BACKUP}.tmp"
        if cp -a "$SNAPSHOT_DIR" "${BUNDLE_BACKUP}.tmp"; then
            rm -rf "$BUNDLE_BACKUP"
            mv "${BUNDLE_BACKUP}.tmp" "$BUNDLE_BACKUP"
        else
            warn "could not keep the replaced files in ${BUNDLE_BACKUP}/"
        fi
    fi
    if [ "${#PLAN_ACTIONS[@]}" -gt 0 ]; then
        FILES_SUMMARY="updated from the ${TARGET} bundle: ${PLAN_PATHS[*]}"
        if [ "${#SNAPSHOT_PATHS[@]}" -gt 0 ]; then
            FILES_SUMMARY="${FILES_SUMMARY} (previous copies in ${BUNDLE_BACKUP}/)"
        fi
    fi
    cache_bundle "$BUNDLE_TGZ" "$BUNDLE_SHA"
    if [ -n "$BASELINE_TGZ" ] && [ "$BASELINE_VERSION" = "$PREV" ]; then
        cache_bundle "$BASELINE_TGZ" "${BASELINE_TGZ}.sha256"
    fi
    self_update
fi

if [ -n "$PREV" ] && [ "$PREV" != "$TARGET" ]; then
    prune_images
    prune_bundles
fi

converge_optional_profiles

echo
echo "============================================================"
echo "DEPLOYED ${TARGET} — /api/health reports it and the stack is up."
if [ -n "$DUMP_HOST" ]; then
    echo "Pre-upgrade dump: ${DUMP_HOST}"
fi
if [ -n "$PREV" ] && [ "$PREV" != "$TARGET" ]; then
    echo "Rollback target:  ${PREV} (its images, and its bundle if fetched, are kept locally)"
fi
echo "Stack files:      ${FILES_SUMMARY}"
if [ "${#OPTIONAL_REAPPLIED[@]}" -gt 0 ]; then
    echo "Re-applied:       ${OPTIONAL_REAPPLIED[*]} (running optional services)"
fi
if [ "${#OPTIONAL_FAILED[@]}" -gt 0 ]; then
    echo "NOT re-applied:   ${OPTIONAL_FAILED[*]} — see the warning above"
fi
if [ -n "$SELF_UPDATED" ]; then
    echo "deploy.sh:        updated to ${SELF_UPDATED}'s; the next run uses it"
fi
echo "App:              ${HEALTH_URL%/api/health}"
if [ "${#PLAN_NOTES[@]}" -gt 0 ] || [ "$TEMPLATE_CHANGES" -gt 0 ]; then
    echo
    echo "Notes:"
    for note in ${PLAN_NOTES[@]+"${PLAN_NOTES[@]}"}; do
        echo "  - ${note}"
    done
    if [ "$TEMPLATE_CHANGES" -gt 0 ]; then
        echo "  - .env.example changed in ${TARGET} — the differences that concern your ${ENV_FILE} are listed above."
    fi
fi
echo "============================================================"
