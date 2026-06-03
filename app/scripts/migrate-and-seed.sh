#!/bin/bash
# ------------------------------------------------------------
# One-shot migration + seed runner for the finance stack.
#
# Runs in the `migrate` Compose service after postgres becomes
# healthy. Idempotent: safe to re-run on every `docker compose up`.
#
# For each target database it:
#   1. Applies any pending Drizzle migrations (drizzle-kit migrate).
#
# Then it applies seed files from /seeds/ (mounted from init-db/seeds):
#   - Finances:      shared-lookups.sql, but ONLY if the DB has no
#                    user data (row-count guard preserves real data).
#   - Finances_Test: shared-lookups.sql + finances-test-mock-data.sql
#                    + rebuild-balance-history.sql. All three files are
#                    idempotent via ON CONFLICT DO NOTHING.
#
# Required env vars (set by docker-compose.yml):
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, FINANCE_APP_DB
# ------------------------------------------------------------
set -euo pipefail

FINANCE_APP_DB="${FINANCE_APP_DB:-Finances}"
TEST_DB="Finances_Test"

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

for db in "${FINANCE_APP_DB}" "${TEST_DB}"; do
    heal_adopted_baseline "${db}"
    run_migrate "${db}"
done

# --- Finances: additive lookup seed, only when the DB is empty.
FINANCES_TXN_COUNT=$(psql -tAc 'SELECT count(*) FROM transactions' -d "${FINANCE_APP_DB}" 2>/dev/null || echo "")
FINANCES_ACCT_COUNT=$(psql -tAc 'SELECT count(*) FROM accounts' -d "${FINANCE_APP_DB}" 2>/dev/null || echo "")

if [ "${FINANCES_TXN_COUNT:-0}" = "0" ] && [ "${FINANCES_ACCT_COUNT:-0}" = "0" ]; then
    echo ">>> Seeding shared lookups into ${FINANCE_APP_DB}..."
    psql -v ON_ERROR_STOP=1 -d "${FINANCE_APP_DB}" -f /seeds/shared-lookups.sql
else
    echo ">>> Skipping ${FINANCE_APP_DB} seed: DB already contains user data" \
         "(accounts=${FINANCES_ACCT_COUNT}, transactions=${FINANCES_TXN_COUNT})."
fi

# --- Finances_Test: full reset-style seed (idempotent).
echo ">>> Seeding shared lookups into ${TEST_DB}..."
psql -v ON_ERROR_STOP=1 -d "${TEST_DB}" -f /seeds/shared-lookups.sql

echo ">>> Seeding mock data into ${TEST_DB}..."
psql -v ON_ERROR_STOP=1 -d "${TEST_DB}" -f /seeds/finances-test-mock-data.sql

echo ">>> Rebuilding ${TEST_DB} account_balance_history..."
psql -v ON_ERROR_STOP=1 -d "${TEST_DB}" -f /seeds/rebuild-balance-history.sql

echo ">>> Migrations and seeds complete."
