#!/bin/bash
# ------------------------------------------------------------
# One-shot migration + seed runner for the finance stack.
#
# Runs in the `migrate` Compose service after postgres becomes
# healthy. Idempotent: safe to re-run on every `docker compose up`.
#
# It first creates the least-privilege service roles from /roles/ (mounted from
# init-db/roles) — those are cluster-global, so once per run. Then, for each
# target database it:
#   1. Applies any pending Drizzle migrations (drizzle-kit migrate).
#   2. Applies that database's service-role grants (/roles/02-grants.sql).
#
# Roles and grants live here rather than in init-db/01-create-databases.sh for
# two reasons (issue #130): that script only runs on an empty data directory, so
# an existing Postgres volume would never gain the roles; and a GRANT names
# tables, so it can only run after step 1 has created them.
#
# Then it applies seed files from /seeds/ (mounted from init-db/seeds):
#   - Finances:      shared-lookups.sql, unconditionally.
#   - Finances_Test: shared-lookups.sql + finances-test-mock-data.sql
#                    + rebuild-balance-history.sql. All three files are
#                    idempotent via ON CONFLICT DO NOTHING.
#
# The Finances seed used to be skipped whenever the DB held any accounts or
# transactions, so a populated database never received a reference row added to
# shared-lookups.sql after it was first seeded — which is how production ended
# up permanently missing transaction_types id=12 "Opening Balance" and 503ing
# the /api/health drift check. The guard was never what protected user data:
# shared-lookups.sql is purely additive (ON CONFLICT DO NOTHING, setval, and
# UPDATEs guarded by `WHERE liquidity_class IS NULL`), so applying it to a
# populated database is a no-op for everything the user owns. That contract is
# now enforced by `npm run check:seed-references` rather than by skipping the
# file — see the header of shared-lookups.sql before editing it (issue #187).
#
# It also converges the Metabase metadata role (/roles/03-metabase-role.sql,
# issue #239). That role is created by init-db/01-create-databases.sh, which
# runs only on an empty PGDATA — so on an existing volume nothing re-asserted
# what it was allowed to be, and it had drifted to SUPERUSER unnoticed.
#
# Required env vars (set by docker-compose.yml):
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, FINANCE_APP_DB
#   FINANCE_APP_DB_PASSWORD, FINANCE_IMPORTER_DB_PASSWORD,
#   FINANCE_APP_DB_PASSWORD etc.  (the service-role passwords, #130)
#   FINANCE_BI_DB_PASSWORD        (the read-only BI role, #249)
#   MB_DB_USER, MB_DB_DBNAME      (names only — no password; see #189)
# ------------------------------------------------------------
set -euo pipefail

FINANCE_APP_DB="${FINANCE_APP_DB:-Finances}"
TEST_DB="Finances_Test"

# Names, not credentials, so these carry defaults rather than the `:?` guards
# below: an unset value here is a misconfiguration, not a security fault, and
# the defaults match .env.example.
MB_DB_USER="${MB_DB_USER:-metabase_user}"
MB_DB_DBNAME="${MB_DB_DBNAME:-metabase}"

# Fail fast and loudly on a missing role password. Compose substitutes an unset
# variable with the empty string rather than leaving it unset, so without these
# guards a stale .env would silently create login roles with blank passwords.
: "${FINANCE_APP_DB_PASSWORD:?must be set — copy the new keys from .env.example into .env (issue #130)}"
: "${FINANCE_IMPORTER_DB_PASSWORD:?must be set — copy the new keys from .env.example into .env (issue #130)}"
: "${FINANCE_BI_DB_PASSWORD:?must be set — copy the new keys from .env.example into .env (issue #249)}"

# Baseline journal `when` — the value drizzle-kit stores as created_at when it
# applies 0000_baseline itself. Derived from the journal so it tracks the file
# rather than being hardcoded. See issue #157.
BASELINE_WHEN=$(node -e "console.log(require('/app/drizzle/migrations/meta/_journal.json').entries.find(e=>e.tag==='0000_baseline').when)")

run_migrate() {
    local db="$1"
    echo ">>> Migrating ${db}..."
    DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${db}" \
        npx drizzle-kit migrate
}

# Self-heal databases that adopted the baseline with a wall-clock created_at
# (the pre-#157 README procedure). drizzle-kit treats a migration as applied only
# if the most-recent stored created_at >= the journal `when`; an adoption row set
# to now()-at-adoption could be earlier than the baseline `when`, so drizzle would
# wrongly re-run 0000_baseline and fail on "relation already exists". Bump any such
# row up to the baseline `when` (exactly what drizzle would have stored). Idempotent:
# a no-op once corrected, a no-op on fresh DBs (table not yet created), and never
# touches 0001+ rows since those carry a larger `when`.
heal_adopted_baseline() {
    local db="$1"
    echo ">>> Checking ${db} for a mis-adopted baseline..."
    psql -v ON_ERROR_STOP=1 -d "${db}" <<SQL
DO \$\$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    UPDATE drizzle.__drizzle_migrations
    SET created_at = ${BASELINE_WHEN}
    WHERE created_at < ${BASELINE_WHEN};
  END IF;
END
\$\$;
SQL
}

# Grants the least-privilege service roles their per-database privileges. Must
# run after run_migrate for the same database: GRANT statements name tables, so
# they fail on a database whose schema has not been created yet.
apply_grants() {
    local db="$1"
    echo ">>> Applying service-role grants to ${db}..."
    psql -v ON_ERROR_STOP=1 -d "${db}" -v OWNER="${PGUSER}" -f /roles/02-grants.sql
}

# Roles are cluster-global, so create them once, before the per-database loop.
echo ">>> Creating least-privilege service roles..."
psql -v ON_ERROR_STOP=1 -d postgres \
    -v app_password="${FINANCE_APP_DB_PASSWORD}" \
    -v importer_password="${FINANCE_IMPORTER_DB_PASSWORD}" \
    -v bi_password="${FINANCE_BI_DB_PASSWORD}" \
    -f /roles/01-create-roles.sql

# Metabase's metadata role (#239). Runs against the metadata database rather
# than `postgres`, because it issues a schema-level GRANT. Skipped rather than
# failed when that database is absent: a cluster that has never provisioned
# Metabase is a valid configuration, and init-db creates the database and the
# role together, so neither exists without the other.
echo ">>> Converging the Metabase metadata role..."
if [ -n "$(psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${MB_DB_DBNAME}'" -d postgres)" ]; then
    psql -v ON_ERROR_STOP=1 -d "${MB_DB_DBNAME}" \
        -v mb_user="${MB_DB_USER}" \
        -f /roles/03-metabase-role.sql
else
    echo ">>> No ${MB_DB_DBNAME} database — skipping."
fi

for db in "${FINANCE_APP_DB}" "${TEST_DB}"; do
    heal_adopted_baseline "${db}"
    run_migrate "${db}"
    apply_grants "${db}"
done

# Retire finance_metabase (#250). 02-grants.sql has just dropped its privileges
# in each database above, which is the precondition for this: a role cannot be
# dropped while it still holds one anywhere.
#
# Deliberately NOT fatal. This job gates finance-app's startup via
# service_completed_successfully, so aborting the stack over a legacy role that
# nothing uses would be a far worse outcome than leaving it in place. A role
# that survives is not silently tolerated either — it has no privileges left, and
# the #239 attribute sweep fails it as an undeclared login role the next time
# the gate runs, which is exactly the loud-but-not-destructive outcome wanted.
if [ -n "$(psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'finance_metabase'" -d postgres)" ]; then
    echo ">>> Retiring the finance_metabase role (#250)..."
    if ! psql -v ON_ERROR_STOP=1 -d postgres -c 'DROP ROLE finance_metabase' 2>&1; then
        echo ">>> WARNING: could not drop finance_metabase. It still holds a privilege in"
        echo ">>>          some database this job does not manage. Find it with:"
        echo ">>>            SELECT datname FROM pg_database WHERE datallowconn;"
        echo ">>>          then, in each: DROP OWNED BY finance_metabase;"
        echo ">>>          and finally:   DROP ROLE finance_metabase;"
    fi
fi

# --- Finances: additive lookup seed, applied whether or not the DB holds user
# data. Backfills canonical reference rows added since this DB was first seeded
# (issue #187); a no-op when they are all already present.
echo ">>> Seeding shared lookups into ${FINANCE_APP_DB}..."
psql -v ON_ERROR_STOP=1 -d "${FINANCE_APP_DB}" -f /seeds/shared-lookups.sql

# --- Finances_Test: full reset-style seed (idempotent).
echo ">>> Seeding shared lookups into ${TEST_DB}..."
psql -v ON_ERROR_STOP=1 -d "${TEST_DB}" -f /seeds/shared-lookups.sql

echo ">>> Seeding mock data into ${TEST_DB}..."
psql -v ON_ERROR_STOP=1 -d "${TEST_DB}" -f /seeds/finances-test-mock-data.sql

echo ">>> Rebuilding ${TEST_DB} account_balance_history..."
psql -v ON_ERROR_STOP=1 -d "${TEST_DB}" -f /seeds/rebuild-balance-history.sql

echo ">>> Migrations, roles, and seeds complete."
