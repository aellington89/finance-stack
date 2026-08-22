#!/usr/bin/env bash
# ------------------------------------------------------------
# Install and upgrade a Finance Stack deployment (Issue #228).
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
#   preflight → pull(target) → backup gate → pin .env → up -d → health gate
#                                  │                                 │
#                                  └────────── rollback ─────────────┘
#
#   * The pull runs BEFORE .env is touched. `docker compose pull` resolves
#     ${APP_VERSION} from .env, so pinning first and pulling second would be
#     fine — but pulling first with APP_VERSION exported for that one command
#     (a shell variable outranks .env in Compose interpolation) means a bad or
#     nonexistent version fails with .env still pristine and nothing running
#     touched.
#   * The dump runs BEFORE .env is re-pinned, and with --no-deps. pg-backup
#     declares `depends_on: migrate: service_completed_successfully`, and
#     `docker compose run` honours depends_on — so without --no-deps, the
#     command whose entire job is "dump before migrate runs" would start
#     migrate. Taking the dump before re-pinning is the second belt: even if a
#     dependency did fire, it would be the already-applied old migrate.
#   * The dump also needs --entrypoint, not a trailing command. pg-backup's
#     entrypoint is a `bash -c "<sleep loop>"`, so a trailing /scripts/backup.sh
#     becomes $0 of that loop and the container spins forever. (deploy/README.md
#     documents the `exec` form, which works because exec bypasses entrypoints.)
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
#   1  aborted before anything was applied (preflight, pull or dump failed) —
#      the running stack and .env are untouched
#   2  upgrade failed, rollback succeeded, the previous version is healthy
#   3  upgrade failed AND rollback failed — needs a human
#
# ENVIRONMENT (script-only overrides; deliberately NOT in .env.example, which
# may carry exactly two variables the root template does not — see
# scripts/check-deploy-parity.sh):
#   DEPLOY_SKIP_PULL=1      skip `docker compose pull` (CI, or an offline host
#                           whose images are already present)
#   DEPLOY_HEALTH_URL       default http://127.0.0.1:3001/api/health
#   DEPLOY_HEALTH_TIMEOUT   seconds to wait for the health gate (default 180)
#
# Requires curl. Uses jq if it is installed and falls back to a text extraction
# if it is not, so the bundle's "Docker Engine and the Compose plugin" is still
# the whole requirement list.
# ------------------------------------------------------------
set -euo pipefail

# Resolve the script's own path BEFORE the cd, so --help can still read it: $0 is
# whatever the caller typed, and a relative path stops resolving the moment the
# working directory changes.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "$SELF")"

ENV_FILE=".env"
STATE_FILE=".deployed-version"
BACKUP_DIR_HOST="backups"
BACKUP_DIR_CONTAINER="/backups"

HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3001/api/health}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-180}"

# Compose's own precedence for the project name, which is what every volume and
# container is prefixed with: COMPOSE_PROJECT_NAME, then the top-level `name:` in
# compose.yml, then the directory. Derived rather than hardcoded to
# finance-stack_postgres_data, because getting this wrong in either direction is
# expensive: a name that does not exist reads a live deployment as a first
# install and skips the backup gate, and a name belonging to someone else's
# project reads a genuinely empty host as an upgrade.
compose_project_name() {
    local from_file
    if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
        printf '%s' "$COMPOSE_PROJECT_NAME"
        return
    fi
    from_file="$(sed -nE 's/^name:[[:space:]]*"?([A-Za-z0-9._-]+)"?.*/\1/p' compose.yml 2>/dev/null | head -n1)"
    printf '%s' "${from_file:-$(basename "$PWD")}"
}

log()  { echo "[deploy] $*"; }
warn() { echo "[deploy] WARNING: $*" >&2; }
die()  { echo "[deploy] ERROR: $*" >&2; exit 1; }

WORK_DIR="$(mktemp -d)"
ENV_PRISTINE="${WORK_DIR}/env.pristine"
ENV_DIRTY=0

cleanup() {
    # Restore .env if we pinned a version and then aborted before either
    # committing the upgrade or completing a rollback. Covers Ctrl-C and any
    # unexpected failure between the pin and the commit.
    if [ "$ENV_DIRTY" -eq 1 ] && [ -f "$ENV_PRISTINE" ]; then
        cp "$ENV_PRISTINE" "$ENV_FILE"
        warn "aborted after pinning — ${ENV_FILE} restored to its previous APP_VERSION"
    fi
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# ------------------------------------------------------------
# .env access
#
# Read, never source: this file is the deployment's whole secret store and its
# values may contain #, spaces or shell metacharacters. Strips one layer of
# surrounding quotes, which Compose also does.
# ------------------------------------------------------------
env_get() {
    local name="$1" value
    value="$(grep -E "^${name}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    printf '%s' "$value"
}

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

# Validated before it can reach awk, a tag reference or a filename.
if ! printf '%s' "$TARGET" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'; then
    die "'${TARGET}' is not a version — expected X.Y.Z"
fi

# ------------------------------------------------------------
# 2. Preflight
# ------------------------------------------------------------
log "preflight…"

command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH"
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is not available (\`docker compose version\` failed)"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon — is it running, and does this user have access?"
command -v curl >/dev/null 2>&1 || die "curl is required for the health gate"
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
# 4. Pull first — a bad or nonexistent version fails here, before anything
#    running is touched and before .env is written.
# ------------------------------------------------------------
if [ "${DEPLOY_SKIP_PULL:-0}" = "1" ]; then
    log "DEPLOY_SKIP_PULL=1 — skipping the pull, using images already present locally"
else
    log "pulling images for ${TARGET}…"
    if ! APP_VERSION="$TARGET" docker compose pull; then
        die "could not pull the images for ${TARGET} — nothing has been changed. Check the version exists: https://github.com/aellington89/finance-stack/releases"
    fi
    log "✓ images for ${TARGET} are present"
fi

# ------------------------------------------------------------
# 5. Pre-upgrade backup gate
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
# takes one safety dump rather than trusting .env.
elif [ -f "$STATE_FILE" ] && [ "$TARGET" = "$PREV" ]; then
    log "skipping the backup gate — ${TARGET} is already deployed, so no schema change can occur (converging only)"
else
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
# 6. Pin, 7. apply, 8. health-gate
# ------------------------------------------------------------
pin_version "$TARGET"

log "applying — postgres → migrate → app/importer, sequenced by compose"
APPLY_OK=1
docker compose up -d || APPLY_OK=0

HEALTH_OK=0
if [ "$APPLY_OK" -eq 1 ]; then
    if poll_health "$TARGET"; then
        HEALTH_OK=1
    fi
fi

# ------------------------------------------------------------
# 9. Rollback on failure
# ------------------------------------------------------------
if [ "$HEALTH_OK" -eq 0 ]; then
    if [ "$APPLY_OK" -eq 0 ]; then
        warn "\`docker compose up -d\` failed for ${TARGET}"
    else
        warn "${TARGET} did not reach a healthy /api/health reporting version ${TARGET} within ${HEALTH_TIMEOUT}s"
    fi
    dump_diagnostics

    if [ -z "$PREV" ] || [ "$PREV" = "$TARGET" ]; then
        # A first install has nothing to roll back to. Leave it up: the logs
        # above are the diagnosis, and tearing it down destroys the evidence.
        cp "$ENV_PRISTINE" "$ENV_FILE" 2>/dev/null || true
        ENV_DIRTY=0
        die "there is no previous version to roll back to. The stack has been left up for inspection — read the migrate log above first, since finance-app does not start until migrate exits 0."
    fi

    warn "rolling back to ${PREV}"
    pin_version "$PREV"

    ROLLBACK_OK=1
    docker compose up -d || ROLLBACK_OK=0
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
# 10. Commit
# ------------------------------------------------------------
printf '%s\n' "$TARGET" > "$STATE_FILE"
ENV_DIRTY=0

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
if [ -n "$PREV" ] && [ "$PREV" != "$TARGET" ]; then
    prune_images
fi

echo
echo "============================================================"
echo "DEPLOYED ${TARGET} — /api/health reports it and the stack is up."
if [ -n "$DUMP_HOST" ]; then
    echo "Pre-upgrade dump: ${DUMP_HOST}"
fi
if [ -n "$PREV" ] && [ "$PREV" != "$TARGET" ]; then
    echo "Rollback target:  ${PREV} (its images are kept locally)"
fi
echo "App:              ${HEALTH_URL%/api/health}"
echo "============================================================"
