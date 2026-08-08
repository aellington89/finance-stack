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
#      matrix cannot: finance_bi reads every core table while `users` and
#      `audit_log` stay refused — the boundary that role exists for — and the
#      de-privileged Metabase metadata role can still create and drop tables in
#      its own database, which is what Metabase does at startup and the failure
#      mode no catalog assertion would ever see (#239).
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
#   FINANCE_BI_DB_PASSWORD           finance_bi password        (required)
#   MB_DB_PASS                       Metabase metadata role pw  (optional — the
#                                    metadata-role cases are skipped without it)
#   MB_DB_USER / MB_DB_DBNAME        metadata role + database   (defaulted)
#   ROLES_DIR                        location of the roles SQL  (default: /roles)
#
# Note: connections must NOT arrive over a pg_hba `trust` rule or the password
# half of this check is vacuous — inside the postgres container, 127.0.0.1 is
# trusted, so pass PGHOST as the service name / container IP instead.
# ------------------------------------------------------------
set -uo pipefail

DB="${1:-Finances_Test}"
ROLES_DIR="${ROLES_DIR:-/roles}"
MB_DB_USER="${MB_DB_USER:-metabase_user}"
MB_DB_DBNAME="${MB_DB_DBNAME:-metabase}"

: "${FINANCE_APP_DB_PASSWORD:?must be set}"
: "${FINANCE_IMPORTER_DB_PASSWORD:?must be set}"
: "${FINANCE_BI_DB_PASSWORD:?must be set}"

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
#
# A session that never opened is failed outright, in both modes. psql exits 2
# when the connection could not be established — wrong password, missing role,
# or CONNECT refused — and every one of those makes the case below meaningless
# rather than passing. It matters in each mode for a different reason: an
# `allow` case keys on the *absence* of a 42501, which a connection failure also
# satisfies, so a wholly wrong password used to sail through every allow case in
# this file; and a `deny` case would otherwise be free to pass because the role
# could not get far enough to be refused for the reason under test.
#
# The optional sixth argument targets another database (the Metabase metadata
# DB); it defaults to the one under test, so no existing call site changes.
expect() {
  local role="$1" pass="$2" mode="$3" label="$4" sql="$5" db="${6:-$DB}" out rc
  out="$(PGPASSWORD="$pass" psql -U "$role" -d "$db" \
        -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qtAc "$sql" 2>&1)"
  rc=$?

  if [ "$rc" -eq 2 ]; then
    echo "FAIL  ${role} could not connect to ${db} — check its password"
    echo "      ${out}"
    failed=1
    return
  fi

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

# expect_no_connect <role> <password> <db> — the role must not reach <db> at all.
#
# Deliberately not folded into expect(). A refused *connection* is reported by
# libpq before psql has a session, so VERBOSITY never applies to it and the
# message carries no SQLSTATE — "FATAL:  permission denied for database" with no
# 42501 anywhere in it. expect()'s code test would read that as "not denied" and
# pass a role that cannot connect at all.
#
# It keys on psql's exit status instead: 2 is "could not connect", which is the
# property under test. A wrong password produces that same 2, so this case alone
# could pass vacuously — what rules that out is the paired positive case, where
# the same role uses the same password to connect to its own database and
# expect() fails on exit 2. Neither check is sufficient by itself; together they
# say the credential is good and the database is still out of reach.
expect_no_connect() {
  local role="$1" pass="$2" db="$3" out rc
  out="$(PGPASSWORD="$pass" psql -U "$role" -d "$db" -qtAc 'SELECT 1' 2>&1)"
  rc=$?

  if [ "$rc" -eq 2 ]; then
    echo "ok    ${role} deny: connect to ${db}"
  else
    echo "FAIL  ${role} must NOT be able to connect to ${db}"
    echo "      ${out:-(the connection succeeded)}"
    failed=1
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
                 + (SELECT count(*) FROM v_daily_totals)
                 + (SELECT count(*) FROM v_audit_log)"

# ── finance_app — DML on the core tables, read-only on users, no DDL ──────
# The "INSERT a transaction" case now carries a second meaning (Issue #180): it
# fires the audit_transactions trigger, and finance_app holds no INSERT on
# audit_log. It passes only because audit_row_change() is SECURITY DEFINER, so a
# regression that dropped that keyword would surface here as a 42501, not as a
# silently missing audit trail.
expect finance_app "$FINANCE_APP_DB_PASSWORD" allow "INSERT a transaction"     "BEGIN; ${INSERT_TXN}; ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" allow "DELETE balance history"   "BEGIN; DELETE FROM account_balance_history; ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" allow "SELECT the four views"    "$READ_VIEWS"
expect finance_app "$FINANCE_APP_DB_PASSWORD" allow "SELECT users"             "SELECT count(*) FROM users"
expect finance_app "$FINANCE_APP_DB_PASSWORD" allow "SELECT audit_log"         "SELECT count(*) FROM audit_log"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "INSERT a user"            "BEGIN; INSERT INTO users (username, password_hash) VALUES ('smoke','x'); ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "UPDATE users"             "BEGIN; UPDATE users SET role = 'admin'; ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "forge an audit row"       "BEGIN; INSERT INTO audit_log (actor_label, actor_source, action, table_name, row_pk) VALUES ('smoke','app','INSERT','transactions','1'); ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "erase audit rows"         "BEGIN; DELETE FROM audit_log; ROLLBACK"
expect finance_app "$FINANCE_APP_DB_PASSWORD" deny  "rewrite an audit row"     "BEGIN; UPDATE audit_log SET actor_label = 'smoke'; ROLLBACK"
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
expect finance_importer "$FINANCE_IMPORTER_DB_PASSWORD" deny  "SELECT audit_log"     "SELECT count(*) FROM audit_log"
expect finance_importer "$FINANCE_IMPORTER_DB_PASSWORD" deny  "SELECT a view"        "SELECT count(*) FROM v_transactions_full"


# ── finance_bi — read-only analytics, never users or audit_log ────────────
# Metabase's connection when questions are built on base tables (#249). The two
# deny cases are the reason this role exists instead of reusing finance_app,
# which holds SELECT on users: a BI credential that can read
# users.password_hash is one native SQL query away from being read, and hiding
# the table in Metabase's admin UI is a display setting, not a boundary.
expect finance_bi "$FINANCE_BI_DB_PASSWORD" allow "SELECT the base tables" \
  "SELECT (SELECT count(*) FROM transactions) + (SELECT count(*) FROM accounts)
        + (SELECT count(*) FROM account_balance_history)"
expect finance_bi "$FINANCE_BI_DB_PASSWORD" allow "SELECT the four views"  "$READ_VIEWS"
expect finance_bi "$FINANCE_BI_DB_PASSWORD" deny  "SELECT users"           "SELECT count(*) FROM users"
expect finance_bi "$FINANCE_BI_DB_PASSWORD" deny  "SELECT audit_log"       "SELECT count(*) FROM audit_log"
expect finance_bi "$FINANCE_BI_DB_PASSWORD" deny  "INSERT a transaction"   "BEGIN; ${INSERT_TXN}; ROLLBACK"
expect finance_bi "$FINANCE_BI_DB_PASSWORD" deny  "UPDATE transactions"    "BEGIN; UPDATE transactions SET amount = 0; ROLLBACK"
expect finance_bi "$FINANCE_BI_DB_PASSWORD" deny  "DELETE transactions"    "BEGIN; DELETE FROM transactions; ROLLBACK"
expect finance_bi "$FINANCE_BI_DB_PASSWORD" deny  "CREATE TABLE"           "CREATE TABLE bi_privilege_smoke (id int)"

# ── MB_DB_USER — owns its metadata DB, and is nothing on the cluster ──────
# The role Metabase authenticates as against its own metadata database. It was
# a full SUPERUSER on the live cluster until #239, so these cases are the
# behavioural half of that fix, and the positive one is the load-bearing case:
# Metabase runs its own schema migrations at startup, so a de-privileged role
# that cannot create a table breaks Metabase on next boot — which the catalog
# would report as perfectly healthy.
#
# Skipped rather than failed when MB_DB_PASS is unset: the catalog gate already
# covers this role's attributes, and requiring the password would make the
# script unrunnable in any context that has not been given it.
echo
if [ -z "${MB_DB_PASS:-}" ]; then
  echo "skip  ${MB_DB_USER}: MB_DB_PASS not set (catalog gate still covers its attributes)"
else
  expect "$MB_DB_USER" "$MB_DB_PASS" allow "create+drop a table in ${MB_DB_DBNAME}" \
    "BEGIN; CREATE TABLE mb_privilege_smoke (id int); DROP TABLE mb_privilege_smoke; ROLLBACK" \
    "$MB_DB_DBNAME"
  expect "$MB_DB_USER" "$MB_DB_PASS" deny  "CREATE ROLE" \
    "CREATE ROLE mb_privilege_smoke_escalation LOGIN" "$MB_DB_DBNAME"
  expect "$MB_DB_USER" "$MB_DB_PASS" deny  "CREATE DATABASE" \
    "CREATE DATABASE mb_privilege_smoke_escalation" "$MB_DB_DBNAME"
  expect_no_connect "$MB_DB_USER" "$MB_DB_PASS" "$DB"
fi

echo
if [ "$failed" -ne 0 ]; then
  echo "role privilege verification FAILED for ${DB}"
  exit 1
fi
echo "role privilege verification passed for ${DB}"
