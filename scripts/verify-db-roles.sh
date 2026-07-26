#!/usr/bin/env bash
# ------------------------------------------------------------
# Verifies the least-privilege service roles (Issue #130).
#
# Two layers, because neither alone is sufficient:
#
#   1. Catalog gate — runs init-db/roles/assert-grants.sql, which asserts the
#      full grant matrix (positively and negatively) against the system catalog.
#   2. Behavioural smoke — connects as each role over a password-authenticated
#      TCP connection and runs real statements, asserting the allowed ones
#      succeed and the forbidden ones fail. This is what proves the mechanic the
#      matrix cannot: finance_metabase reads the views while having no privilege
#      whatsoever on their base tables (the views are not security_invoker, so
#      they execute with the view owner's rights).
#
# Writes are wrapped in BEGIN … ROLLBACK, so this is safe to run against a
# populated database — but point it at Finances_Test by default.
#
# Used by the "role privilege gate" step in .github/workflows/ci.yml, and
# runnable by hand against the live stack — the migrate service already carries
# every variable this needs, so no -e flags are required:
#
#   docker compose run --rm --entrypoint bash migrate /scripts/verify-db-roles.sh Finances
#
# Environment (all supplied by the migrate service in docker-compose.yml):
#   PGHOST/PGPORT/PGUSER/PGPASSWORD  superuser connection (for the catalog gate)
#   FINANCE_APP_DB_PASSWORD          finance_app password       (required)
#   FINANCE_IMPORTER_DB_PASSWORD     finance_importer password  (required)
#   FINANCE_METABASE_DB_PASSWORD     finance_metabase password  (required)
#   ROLES_DIR                        location of the roles SQL  (default: /roles)
#
# Note: connections must NOT arrive over a pg_hba `trust` rule or the password
# half of this check is vacuous — inside the postgres container, 127.0.0.1 is
# trusted, so pass PGHOST as the service name / container IP instead.
# ------------------------------------------------------------
set -uo pipefail

DB="${1:-Finances_Test}"
ROLES_DIR="${ROLES_DIR:-/roles}"

: "${FINANCE_APP_DB_PASSWORD:?must be set}"
: "${FINANCE_IMPORTER_DB_PASSWORD:?must be set}"
: "${FINANCE_METABASE_DB_PASSWORD:?must be set}"

failed=0

echo "==> Catalog gate: assert-grants.sql against ${DB}"
if ! psql -v ON_ERROR_STOP=1 -d "$DB" -f "${ROLES_DIR}/assert-grants.sql"; then
  echo "FAIL  grant matrix assertions did not pass"
  failed=1
fi

echo
echo "==> Behavioural smoke: connecting as each role"

# expect <role> <password> allow|deny <label> <sql>
#
# Asserts on whether the statement was refused for lack of privilege, not on
# whether it merely failed. Postgres evaluates privileges before it executes, so
# a denial is data-independent — which keeps this check meaningful against an
# empty Finances (a fresh database has lookup rows but no accounts, so an INSERT
# into transactions legitimately trips a NOT NULL constraint that says nothing
# about the grant under test).
#
# Detection keys on SQLSTATE 42501 (insufficient_privilege), surfaced by
# VERBOSITY=verbose, rather than on the message text — the wording differs
# between a plain refusal ("permission denied for table users") and an ownership
# one ("must be owner of table transactions"), and the text is localized while
# the code is not.
expect() {
  local role="$1" pass="$2" mode="$3" label="$4" sql="$5" out
  out="$(PGPASSWORD="$pass" psql -U "$role" -d "$DB" \
        -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qtAc "$sql" 2>&1)"

  local denied=0
  case "$out" in
    *"ERROR:  42501"*) denied=1 ;;
  esac

  if [ "$mode" = allow ] && [ "$denied" -eq 1 ]; then
    echo "FAIL  ${role} must be able to: ${label}"
    echo "      ${out}"
    failed=1
  elif [ "$mode" = deny ] && [ "$denied" -eq 0 ]; then
    echo "FAIL  ${role} must NOT be able to: ${label}"
    echo "      expected a permission-denied error, got: ${out:-(statement succeeded)}"
    failed=1
  else
    echo "ok    ${role} ${mode}: ${label}"
  fi
}

# Derives account/type/category from existing rows so this works against any
# seeded database. Rolled back, so no row is ever actually committed.
INSERT_TXN="INSERT INTO transactions
  (transaction_description, transaction_date, account_id, amount,
   transaction_type_id, transaction_category_id)
  SELECT 'privilege-smoke', CURRENT_DATE, min(a.account_id), 1.00,
         (SELECT min(transaction_type_id) FROM transaction_types),
         (SELECT min(transaction_category_id) FROM transaction_categories)
  FROM accounts a"

READ_VIEWS="SELECT (SELECT count(*) FROM v_transactions_full)
                 + (SELECT count(*) FROM v_account_balances_current)
                 + (SELECT count(*) FROM v_daily_totals)"

# ── finance_app — DML on the core tables, read-only on users, no DDL ──────
expect finance_app "$FINANCE_APP_DB_PASSWORD" allow "INSERT a transaction"     "BEGIN; ${INSERT_TXN}; ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" allow "DELETE balance history"   "BEGIN; DELETE FROM account_balance_history; ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" allow "SELECT the three views"   "$READ_VIEWS"
expect finance_app "$FINANCE_APP_DB_PASSWORD" allow "SELECT users"             "SELECT count(*) FROM users"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "INSERT a user"            "BEGIN; INSERT INTO users (username, password_hash) VALUES ('smoke','x'); ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "UPDATE users"             "BEGIN; UPDATE users SET role = 'admin'; ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "TRUNCATE transactions"    "BEGIN; TRUNCATE transactions CASCADE; ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "CREATE TABLE"             "CREATE TABLE privilege_smoke_escalation (id int)"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "DROP TABLE transactions"  "BEGIN; DROP TABLE transactions CASCADE; ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "CREATE ROLE"              "CREATE ROLE privilege_smoke_escalation LOGIN"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "setval a sequence"        "SELECT setval(pg_get_serial_sequence('transactions','transaction_id'), 1)"

# ── finance_importer — append-only on transactions, lookup reads only ─────
expect finance_importer "$FINANCE_IMPORTER_DB_PASSWORD" allow "INSERT a transaction" "BEGIN; ${INSERT_TXN}; ROLLBACK"
expect finance_importer "$FINANCE_IMPORTER_DB_PASSWORD" allow "SELECT the lookup maps" \
  "SELECT (SELECT count(*) FROM accounts) + (SELECT count(*) FROM transaction_categories) + (SELECT count(*) FROM transaction_types)"
expect finance_importer "$FINANCE_IMPORTER_DB_PASSWORD" deny  "UPDATE transactions"  "BEGIN; UPDATE transactions SET amount = 0; ROLLBACK"
expect finance_importer "$FINANCE_IMPORTER_DB_PASSWORD" deny  "DELETE transactions"  "BEGIN; DELETE FROM transactions; ROLLBACK"
expect finance_importer "$FINANCE_IMPORTER_DB_PASSWORD" deny  "SELECT users"         "SELECT count(*) FROM users"
expect finance_importer "$FINANCE_IMPORTER_DB_PASSWORD" deny  "SELECT a view"        "SELECT count(*) FROM v_transactions_full"

# ── finance_metabase — the three views and nothing else ──────────────────
expect finance_metabase "$FINANCE_METABASE_DB_PASSWORD" allow "SELECT the three views"       "$READ_VIEWS"
expect finance_metabase "$FINANCE_METABASE_DB_PASSWORD" deny  "SELECT base table transactions" "SELECT count(*) FROM transactions"
expect finance_metabase "$FINANCE_METABASE_DB_PASSWORD" deny  "SELECT base table accounts"     "SELECT count(*) FROM accounts"
expect finance_metabase "$FINANCE_METABASE_DB_PASSWORD" deny  "SELECT users"                   "SELECT count(*) FROM users"
expect finance_metabase "$FINANCE_METABASE_DB_PASSWORD" deny  "INSERT a transaction"           "BEGIN; ${INSERT_TXN}; ROLLBACK"

echo
if [ "$failed" -ne 0 ]; then
  echo "role privilege verification FAILED for ${DB}"
  exit 1
fi
echo "role privilege verification passed for ${DB}"
