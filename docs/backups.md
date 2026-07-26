# Backups & disaster recovery

Covers the scheduled backup service, where dumps live, retention, and how to
restore.

## Overview

The `pg-backup` service runs a scheduled `pg_dump` of each configured database
into `./backups/` on the host, pruning old dumps on a retention window. It runs
by default (`docker compose up`) alongside Postgres and reuses the
`postgres:18.0` image, so `pg_dump`/`pg_restore` stay version-matched to the
server.

Dumps use PostgreSQL's **custom format** (`pg_dump -Fc`): compressed and
restorable with `pg_restore`. Files are named `<db>_<UTC-timestamp>.dump`, e.g.
`Finances_20260711T060000Z.dump`.

> **Backups contain financial data.** `./backups/` is gitignored and never
> committed. Off-site/encrypted storage is a separate phase-2 concern (see
> [below](#off-site-phase-2)).

## Configuration

Set in `.env` (see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `BACKUP_DBS` | `Finances,metabase` | Comma-separated databases to dump. Keep in sync with `FINANCE_APP_DB` / `MB_DB_DBNAME` if you rename them. |
| `BACKUP_RETENTION_DAYS` | `14` | Dumps older than this are pruned — but the newest dump of each database is always kept. |
| `BACKUP_INTERVAL_SECONDS` | `86400` | Seconds between backup runs (default daily). |

The service dumps once at start and then every `BACKUP_INTERVAL_SECONDS`. Its
Docker healthcheck reports **unhealthy** if no dump is newer than 1.5× the
interval — a quick signal that the backup loop has stalled.

## Where dumps land

`./backups/` in the repo root (bind-mounted into the service at `/backups`).
List them with:

```bash
ls -lt backups/
```

## Restoring

`scripts/restore.sh` drops and recreates the target database, then applies the
dump. It runs inside the running Postgres container so no local client is
needed:

```bash
# Restore the newest Finances dump into a throwaway database to verify it:
docker compose exec pg-backup /scripts/restore.sh --force Finances Finances_Restore_Check
```

Usage: `restore.sh [--force] [DUMP_FILE] [TARGET_DB]`

- `DUMP_FILE` can be a path, a bare filename in `/backups`, a **database name**
  (→ newest dump of that DB), or `latest`/omitted (→ newest dump across all
  databases — ambiguous when several DBs are backed up, so prefer the DB name).
- `TARGET_DB` omitted → derived from the dump's filename prefix (or
  `RESTORE_TARGET_DB`).
- `--force` is **required** to restore over a production database
  (`Finances` / `metabase`), since the target is dropped and recreated.

### Full disaster recovery (restore over the live database)

```bash
# Restores the latest Finances dump back over the production Finances database.
# This DROPS the current Finances DB first — be sure.
docker compose exec pg-backup /scripts/restore.sh --force \
  /backups/Finances_<timestamp>.dump Finances
```

For a from-scratch rebuild (lost volume), bring the stack up so the databases
are created and migrated, then run the restore above.

## Verification (CI)

`.github/workflows/backup-smoke.yml` runs weekly (and on PRs touching the backup
scripts). It seeds a known dataset, runs `backup.sh`, restores the dump into a
throwaway database, and asserts a known row count — catching silent dump/restore
corruption and script regressions.

Because GitHub runners can't reach the deployment host's `./backups/`, the job
verifies the backup/restore **scripts and round-trip**, not a specific host's
dumps.

## Off-site (phase 2)

Off-host, encrypted storage (S3/B2/rclone) and WAL archiving / point-in-time
recovery are out of scope here. `scripts/backup.sh` exposes a `BACKUP_POST_HOOK`
extension point — set it to an executable that ships the fresh dumps off-host
after each run. When the off-site feature is built, the smoke check should be
extended to verify the real uploaded dumps.
