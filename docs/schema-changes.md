# Schema Changes

Covers making schema changes and adopting migrations on existing databases.

## Making Schema Changes

`app/drizzle/schema.ts` is the single source of truth for the database schema. The flow for any schema change is:

1. **Edit `app/drizzle/schema.ts`** — add a column, table, index, or view.
2. **If your change adds, removes, or renames a foreign key,** also hand-update [`app/drizzle/relations.ts`](../app/drizzle/relations.ts) to keep the relational query API (`db.query.*`) in sync. Drizzle's generator does not touch this file — only `drizzle-kit pull` regenerates it, and pull is inspection-only. Stale relations fail silently (relational queries return `undefined` for the missing relation with no error).
3. **Generate a migration:** `cd app && npm run db:generate -- --name <short-description>` produces a new `app/drizzle/migrations/NNNN_<description>.sql` file plus an updated snapshot under `meta/`.
4. **Review the generated SQL** — confirm it does what you expected; edit by hand if needed for things Drizzle doesn't model (e.g., `COMMENT ON TABLE`, advanced index types).
5. **Commit both the schema change and the migration** in the same PR.
6. **Migrations apply automatically** on the next `docker compose up` via the `migrate` service. To apply manually against a running stack: `docker compose run --rm migrate`.

> **Applied migration SQL files are immutable.** Once a migration has been applied anywhere (any local DB, a teammate's, or CI), never hand-edit its `.sql` file — drizzle records a hash of the file at apply time, so editing it silently desyncs the ledger from the applied schema. Ship any correction as a **new** follow-on migration (`npm run db:generate`). The op-class fix in commit `45bea06`, which edited `0000_baseline.sql` after it had already been applied, is exactly the case to avoid; it contributed to issue #157.

`npm run db:pull` is now **inspection only** — it overwrites `schema.ts` from the live DB, which is useful for verifying a migration applied as expected but should never be committed as the source of truth.

CI runs a drift gate that invokes `drizzle-kit generate` after applying migrations. If `schema.ts` diverges from the latest meta snapshot, generate produces a new migration SQL file under `drizzle/migrations/`; CI then fails the build with a message pointing at `npm run db:generate`. This catches the common case of editing `schema.ts` without running `db:generate` — without depending on `drizzle-kit pull`'s catalog introspection, which has known cosmetic non-determinism (e.g. composite-index op classes, PK column order).

## Adopting Migrations on an Existing Database

If you've been running this stack before migrations existed, your `Finances` (and any pre-existing `Finances_Test`) have the tables but no `__drizzle_migrations` history. The first `migrate` run will try to re-apply `0000_baseline.sql` and fail on `CREATE TABLE` conflicts. To mark the baseline as already-applied without losing data, run this once before the first migrate:

```bash
# Compute the baseline hash, then insert it into every DB that already has the tables.
HASH=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('app/drizzle/migrations/0000_baseline.sql', 'utf8')).digest('hex'))")
# created_at MUST be the baseline journal `when` — the exact value drizzle-kit stores
# when it applies 0000 itself. drizzle treats a migration as applied only if the most
# recent stored created_at >= the journal `when`, so a wall-clock now() that lands
# before `when` makes drizzle re-run the baseline (issue #157). Derive it from the
# journal so it can't drift.
WHEN=$(node -e "console.log(require('./app/drizzle/migrations/meta/_journal.json').entries.find(e=>e.tag==='0000_baseline').when)")
for DB in Finances Finances_Test; do
  docker exec -i postgres psql -U postgres -d "$DB" <<EOF
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id serial PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('$HASH', $WHEN);
EOF
done
```

After this, `docker compose run --rm migrate` is a no-op on existing DBs (baseline already applied) and future migrations apply normally. Drop the `Finances_Test` half of the loop if that DB doesn't exist yet.

> **Note:** the `migrate` service ([`app/scripts/migrate-and-seed.sh`](../app/scripts/migrate-and-seed.sh)) also self-heals a DB that was adopted with an earlier `created_at` (e.g. by the pre-#157 `now()` procedure): it bumps any baseline row recorded before the journal `when` up to it on every run. So this manual procedure is only needed for the **very first** adoption of a brand-new DB that has no `__drizzle_migrations` table at all.
