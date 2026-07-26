#!/usr/bin/env bash
# ------------------------------------------------------------
# Restore a finance-stack database dump into a clean database.
#
# Usage:
#   scripts/restore.sh [--force] [DUMP_FILE] [TARGET_DB]
#
#   DUMP_FILE   One of:
#                 - a path to a .dump produced by scripts/backup.sh, or
#                 - a bare filename inside BACKUP_DIR, or
#                 - a database name (e.g. "Finances") → newest dump of that DB, or
#                 - "latest" / omitted → newest dump across all databases.
#   TARGET_DB   Database to restore into. Omitted → derived from the
#               dump's filename prefix (e.g. Finances_2026….dump →
#               "Finances"), or RESTORE_TARGET_DB if set.
#   --force     Required to restore over a production database name
#               (Finances / metabase). Destructive — the target DB is
#               dropped and recreated first.
#
# The target database is DROPPED and RECREATED, then the dump is
# applied with pg_restore --no-owner. Connections to the target are
# terminated first so the DROP can proceed.
#
# Environment:
#   PGHOST                Postgres host          (default: postgres)
#   PGPORT                Postgres port          (default: 5432)
#   PGUSER                Postgres superuser     (required)
#   PGPASSWORD            Password for PGUSER    (required)
#   BACKUP_DIR            Where dumps live       (default: /backups)
#   RESTORE_TARGET_DB     Default target DB when not derivable
# ------------------------------------------------------------
set -euo pipefail

PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
export PGHOST PGPORT

log() { echo "[restore] $*"; }
die() { echo "[restore] ERROR: $*" >&2; exit 1; }

# Databases that must not be clobbered without --force.
PROTECTED_DBS="Finances metabase"

force=0
args=()
for a in "$@"; do
  if [ "$a" = "--force" ]; then
    force=1
  else
    args+=("$a")
  fi
done

dump_arg="${args[0]:-}"
target_db="${args[1]:-}"

# Resolve the dump to restore. SC2012: dump filenames are controlled
# (db name + UTC timestamp, no spaces/newlines), so time-sorting with ls is safe.
if [ -z "$dump_arg" ] || [ "$dump_arg" = "latest" ]; then
  # Newest dump across all databases. Ambiguous when several DBs are backed up —
  # prefer naming the database (below) when you have more than one.
  # shellcheck disable=SC2012
  dump_file="$(ls -1t "${BACKUP_DIR}/"*.dump 2>/dev/null | head -n1 || true)"
  [ -z "$dump_file" ] && die "no dump given and no *.dump found in ${BACKUP_DIR}"
  log "using newest dump: $(basename "$dump_file")"
elif [ -f "$dump_arg" ]; then
  dump_file="$dump_arg"                       # explicit path
elif [ -f "${BACKUP_DIR}/${dump_arg}" ]; then
  dump_file="${BACKUP_DIR}/${dump_arg}"       # bare filename inside BACKUP_DIR
else
  # Treat as a database name: newest <name>_*.dump in BACKUP_DIR.
  # shellcheck disable=SC2012
  dump_file="$(ls -1t "${BACKUP_DIR}/${dump_arg}_"*.dump 2>/dev/null | head -n1 || true)"
  [ -z "$dump_file" ] && die "no dump file or database series matching '${dump_arg}' in ${BACKUP_DIR}"
  log "using newest '${dump_arg}' dump: $(basename "$dump_file")"
fi
[ -f "$dump_file" ] || die "dump file not found: ${dump_file}"

# Default target: prefix of the dump filename (before the first "_"),
# or RESTORE_TARGET_DB.
if [ -z "$target_db" ]; then
  if [ -n "${RESTORE_TARGET_DB:-}" ]; then
    target_db="$RESTORE_TARGET_DB"
  else
    base="$(basename "$dump_file")"
    target_db="${base%%_*}"
  fi
  log "no target DB specified — using: ${target_db}"
fi

# Guard against clobbering a production database without --force.
for p in $PROTECTED_DBS; do
  if [ "$target_db" = "$p" ] && [ "$force" -ne 1 ]; then
    die "refusing to overwrite protected database '${target_db}' without --force"
  fi
done

log "restoring $(basename "$dump_file") -> database '${target_db}' on ${PGHOST}:${PGPORT}"

# Terminate open connections so DROP DATABASE can proceed, then recreate.
psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE datname = '${target_db}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "${target_db}";
CREATE DATABASE "${target_db}";
SQL

pg_restore --no-owner -U "$PGUSER" -d "$target_db" "$dump_file"

log "done — restored into '${target_db}'"
