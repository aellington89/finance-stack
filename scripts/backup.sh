#!/usr/bin/env bash
# ------------------------------------------------------------
# Scheduled logical backup of the finance-stack databases.
#
# Runs a compressed pg_dump (custom format, -Fc) of each database
# listed in BACKUP_DBS into BACKUP_DIR, then prunes dumps older
# than BACKUP_RETENTION_DAYS — always keeping at least the newest
# dump of each database, so a paused stack never prunes itself to
# zero.
#
# Invoked on a loop by the pg-backup service in docker-compose.yml
# (and once per run by the weekly backup-smoke CI job). Restore a
# dump with scripts/restore.sh.
#
# Custom format (-Fc) is chosen so restore.sh can use pg_restore
# (compressed, selective, --no-owner). Running this from the
# postgres:18.0 image keeps pg_dump version-matched to the server,
# avoiding cross-major-version dump failures.
#
# Environment (all have sensible defaults except credentials):
#   PGHOST                 Postgres host                (default: postgres)
#   PGPORT                 Postgres port                (default: 5432)
#   PGUSER                 Postgres superuser           (required)
#   PGPASSWORD             Password for PGUSER          (required)
#   BACKUP_DBS             Comma-separated DB names     (default: Finances)
#   BACKUP_DIR             Output directory             (default: /backups)
#   BACKUP_RETENTION_DAYS  Prune dumps older than N days(default: 14)
#   BACKUP_POST_HOOK       Optional path to a script run after each
#                          successful run — the phase-2 off-site seam.
# ------------------------------------------------------------
set -euo pipefail

PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
BACKUP_DBS="${BACKUP_DBS:-Finances}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

export PGHOST PGPORT

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

# Split the comma-separated list into an array (trims surrounding spaces).
IFS=',' read -ra dbs <<< "$BACKUP_DBS"

dumped=0
for raw in "${dbs[@]}"; do
  db="$(echo "$raw" | xargs)"   # trim whitespace
  [ -z "$db" ] && continue

  # Skip (don't fail the whole run) if the database doesn't exist —
  # e.g. metabase before its first init on a partial stack.
  if ! psql -U "$PGUSER" -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname = '${db}'" | grep -q 1; then
    log "WARNING: database '${db}' does not exist — skipping"
    continue
  fi

  final="${BACKUP_DIR}/${db}_${timestamp}.dump"
  tmp="${final}.tmp"

  log "dumping '${db}' -> $(basename "$final")"
  # Dump to a .tmp name first, then atomically rename — a crash mid-dump
  # never leaves a file that looks like a complete backup.
  pg_dump -U "$PGUSER" -d "$db" -Fc -f "$tmp"
  mv "$tmp" "$final"
  dumped=$((dumped + 1))

  # Retention prune for this DB, but never delete its newest dump.
  # SC2012: dump filenames are controlled (db name + UTC timestamp, no spaces
  # or newlines), so time-sorting with ls is safe and simpler than find here.
  # shellcheck disable=SC2012
  newest="$(ls -1t "${BACKUP_DIR}/${db}_"*.dump 2>/dev/null | head -n1 || true)"
  while IFS= read -r old; do
    [ -z "$old" ] && continue
    [ "$old" = "$newest" ] && continue   # safety floor: keep the latest
    log "pruning aged dump $(basename "$old")"
    rm -f "$old"
  done < <(find "$BACKUP_DIR" -maxdepth 1 -name "${db}_*.dump" -type f \
             -mtime "+${BACKUP_RETENTION_DAYS}" 2>/dev/null)
done

if [ "$dumped" -eq 0 ]; then
  log "ERROR: no databases were dumped (check BACKUP_DBS='${BACKUP_DBS}')"
  exit 1
fi

# Phase-2 off-site seam: if a post-hook is configured, run it so the fresh
# dumps can be shipped off-host (S3/B2/rclone). No-op by default.
if [ -n "${BACKUP_POST_HOOK:-}" ] && [ -x "${BACKUP_POST_HOOK}" ]; then
  log "running BACKUP_POST_HOOK ${BACKUP_POST_HOOK}"
  "${BACKUP_POST_HOOK}" "$BACKUP_DIR"
fi

log "done — ${dumped} database(s) dumped to ${BACKUP_DIR}"
