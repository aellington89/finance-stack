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

run_migrate() {
    local db="$1"
    echo ">>> Migrating ${db}..."
    DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${db}" \
        npx drizzle-kit migrate
}

run_migrate "${FINANCE_APP_DB}"
run_migrate "${TEST_DB}"

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
