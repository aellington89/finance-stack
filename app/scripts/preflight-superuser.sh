#!/usr/bin/env bash
# ------------------------------------------------------------
# Superuser connection preflight (Issue #189).
#
# Run first by app/scripts/migrate-and-seed.sh, before anything that needs a
# database. Its whole job is to turn one specific failure into an actionable
# one: POSTGRES_PASSWORD in .env no longer matching the password stored in the
# Postgres volume.
#
# Why that needs its own check. The image applies POSTGRES_PASSWORD only through
# `initdb --pwfile`, inside a branch the entrypoint skips once $PGDATA/PG_VERSION
# exists. Editing the value on an existing volume therefore changes nothing, and
# every service authenticating with the new one breaks. The three service roles
# (#130) and the Metabase metadata role (#189) avoid this because migrate
# re-issues ALTER ROLE ... PASSWORD for them on every run.
#
# The superuser cannot be fixed the same way, and that is not an oversight:
# migrate authenticates AS this role. By the time .env and the stored password
# disagree, migrate cannot connect — so an ALTER it would have issued never runs.
# Re-asserting the password on every `up` would be dead code on the one occasion
# it mattered. What is left is to fail well, which is this file.
#
# Runnable by hand as a diagnostic — the migrate service carries every variable
# it needs, so no -e flags are required:
#
#   docker compose run --rm --entrypoint bash migrate /app/scripts/preflight-superuser.sh
#
# Environment (set by the migrate service in docker-compose.yml):
#   PGHOST, PGPORT, PGUSER, PGPASSWORD
# ------------------------------------------------------------
#
# Deliberately not `set -e`: this script's entire purpose is to inspect a failing
# exit code rather than die on it.
set -uo pipefail

# Exported, not just assigned: psql reads these from the environment, and a
# bare assignment to a name that was never in it would be invisible to psql.
export PGHOST="${PGHOST:-postgres}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"

echo ">>> Checking the superuser connection..."

# -w so a server that would otherwise prompt fails immediately instead of
# hanging a non-interactive job forever waiting on a password nobody will type.
probe="$(psql -w -d postgres -qtAc 'SELECT 1' 2>&1)"
rc=$?

if [ "$rc" -eq 0 ]; then
    echo ">>> Superuser connection OK (${PGUSER}@${PGHOST}:${PGPORT})."
    exit 0
fi

# Distinguish "wrong password" from "server not there". pg_isready reports
# whether the server is accepting connections WITHOUT authenticating, so it
# answers that question on its own and does so independently of locale. The
# message text is checked only as a fallback, because libpq localizes it — and
# because a refused connection carries no SQLSTATE to key on, which is the same
# constraint scripts/verify-db-roles.sh works around with exit statuses.
if pg_isready -h "$PGHOST" -p "$PGPORT" -q || [[ "$probe" == *"password authentication failed"* ]]; then
    cat >&2 <<EOF

ERROR: POSTGRES_PASSWORD in .env does not match the password stored for
       role "${PGUSER}" in this Postgres volume.

       The image applies POSTGRES_PASSWORD only via initdb, on an EMPTY
       data directory. Editing it later changes nothing, and migrate
       authenticates AS this role — so it cannot repair the mismatch.

       Alter the role FIRST, then update .env:
         docker compose exec postgres psql -U ${PGUSER}
         \\password ${PGUSER}
         # set POSTGRES_PASSWORD in .env to the same value
         docker compose up -d --force-recreate

       See docs/database.md#rotating-a-role-password  (issue #189)

       psql said: ${probe}
EOF
    exit 1
fi

cat >&2 <<EOF

ERROR: cannot reach Postgres at ${PGHOST}:${PGPORT} as "${PGUSER}".

       The server is not accepting connections, so this is a connectivity
       problem rather than a credential one. Check that the postgres service
       is up and healthy:  docker compose ps postgres

       psql said: ${probe}
EOF
exit 1
