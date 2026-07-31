# Audit Log

Every insert, update and delete on the financial and lookup tables is recorded in
`audit_log` with the actor who made it and the full row state before and after.
Added in [Issue #180](https://github.com/aellington89/finance-stack/issues/180).

## Why triggers rather than application code

The obvious implementation is to write an audit row from each server action in
`app/lib/actions/`. This does not, because:

- **The app is not the only writer.** The Python importer
  ([`importer/poll.py`](../importer/poll.py)) inserts into `transactions`
  directly as `finance_importer`, and an operator can always reach `psql`.
  Application-side logging would be blind to exactly the writes that are hardest
  to explain after the fact.
- **The app should not be able to write the log.** `audit_row_change()` is
  `SECURITY DEFINER` and owned by `POSTGRES_USER`, so it inserts with the
  owner's rights. `finance_app` holds `SELECT` on `audit_log` and nothing else
  ([`init-db/roles/02-grants.sql`](../init-db/roles/02-grants.sql)). An
  application-level compromise can cause audit rows but can neither forge one
  nor delete one covering its tracks.
- **`to_jsonb(OLD)` / `to_jsonb(NEW)` capture every column** without per-action
  maintenance. Hand-written audit writes need an extra `SELECT` per mutation and
  go stale the moment a column is added.

The cost is that the app must name the actor out-of-band, which is what the next
section is about.

## How the actor gets recorded

The trigger reads two transaction-local settings:

| Setting | Value |
|---|---|
| `app.actor_user_id` | the signed-in user's `users.user_id` |
| `app.actor_label` | their username |

They are set by `auditedTransaction()` in
[`app/lib/db/audited.ts`](../app/lib/db/audited.ts), which is the **only** thing
that sets them. Every mutating server action goes through it:

```ts
await auditedTransaction(async (tx) => {
  await tx.insert(transactions).values({ ... });
});
```

Two consequences worth knowing:

1. **`set_config(..., true)` is transaction-local, and that matters.** `db` is a
   shared `pg.Pool`, so a session-scoped setting would outlive the request on
   that pooled connection and mis-attribute the next user's writes. It is also
   why writes must be inside an explicit transaction — a bare `db.update(...)`
   runs in an implicit one, leaving nowhere safe to put the actor.
2. **Nothing is unattributed.** A write with no settings present — the importer,
   `psql`, a restore script — still produces an audit row, attributed to its
   database role via `current_user` with `actor_source = 'database'`.

| `actor_source` | `actor_user_id` | `actor_label` | Who |
|---|---|---|---|
| `app` | the user's uuid | their username | a signed-in user through the UI |
| `database` | `NULL` | `finance_importer` | the importer |
| `database` | `NULL` | `postgres` | an operator in `psql`, a migration, a restore |

`actor_user_id` has **no foreign key** to `users`: the log has to survive the
deletion of the user it names, which is what `actor_label` preserves.

## What is covered

Audited: `transactions`, `accounts`, `transaction_categories`,
`transaction_types`, `account_types`, `account_type_categories`.

Two deliberate exclusions:

- **`account_balance_history`** is derived, not entered. `rebuildAccountBalance()`
  rewrites an account's entire history on every transaction write, so a trigger
  there would generate hundreds of rows per edit and bury the real signal. The
  history is reproducible from `transactions`, which *is* audited.
- **`users`** has no application write path at all — `02-grants.sql` revokes
  INSERT/UPDATE/DELETE from `finance_app`, and the only writer is
  `npm run auth:create-user`, which connects as `POSTGRES_USER`. Auditing it
  would also mean deciding what to do about `password_hash`.

Both exclusions are pinned by tests in
[`app/tests/integration/actions/audit.test.ts`](../app/tests/integration/actions/audit.test.ts),
so adding a trigger later is a deliberate act rather than an accident.

## Schema

| Column | Notes |
|---|---|
| `audit_id` | `bigint`, identity |
| `occurred_at` | `timestamptz`, defaults to `now()` |
| `actor_user_id` | `uuid`, null for non-app writers |
| `actor_label` | username, or the database role |
| `actor_source` | `app` or `database` |
| `action` | `INSERT`, `UPDATE` or `DELETE` |
| `table_name` | the audited table |
| `row_pk` | primary-key value(s), `\|`-joined for composite keys |
| `before_data` | full row as `jsonb`; null on INSERT |
| `after_data` | full row as `jsonb`; null on DELETE |
| `changed_columns` | `text[]`, populated on UPDATE only |

Indexed on `(table_name, row_pk, occurred_at)` for row history and on
`(occurred_at)` for recent activity. Both are ascending — a btree serves
`ORDER BY ... DESC` by scanning backwards.

## Reading the log

`v_audit_log` is the read surface and is the only audit object granted to
`finance_metabase`, so the log is browsable in Metabase alongside the other three
views (see [Roles & Privileges](database.md#roles--privileges)).

The full history of one transaction, newest first:

```sql
SELECT occurred_at, actor_label, actor_source, action, changed_columns
FROM v_audit_log
WHERE table_name = 'transactions' AND row_pk = '1234'
ORDER BY occurred_at DESC;
```

What changed in the last 7 days, and who did it:

```sql
SELECT occurred_at, actor_label, action, table_name, row_pk, changed_columns
FROM v_audit_log
WHERE occurred_at > now() - interval '7 days'
ORDER BY occurred_at DESC;
```

Every edit that moved an amount, with the old and new values:

```sql
SELECT occurred_at, actor_label, row_pk,
       before_data ->> 'amount' AS was,
       after_data  ->> 'amount' AS now
FROM v_audit_log
WHERE table_name = 'transactions'
  AND action = 'UPDATE'
  AND 'amount' = ANY (changed_columns)
ORDER BY occurred_at DESC;
```

Anything not done by a signed-in user:

```sql
SELECT occurred_at, actor_label, action, table_name, row_pk
FROM v_audit_log
WHERE actor_source = 'database'
ORDER BY occurred_at DESC;
```

## Retention

**The log is kept indefinitely and nothing prunes it automatically.** At this
stack's write volume the table stays small for years, and "who changed what" is
most valuable precisely when it is old — so there is no scheduled deletion to
misconfigure and no silent data loss.

It is included in the `Finances` dump taken by the `pg-backup` service (see
[Backups](backups.md)), so it does grow backup size over time. If that ever
becomes a problem, prune by hand as `POSTGRES_USER` — no service role can:

```bash
docker exec -i postgres psql -U postgres -d Finances \
  -c "DELETE FROM audit_log WHERE occurred_at < now() - interval '24 months';"
```

Take a backup first. This is irreversible and, by design, itself unaudited.

## Changing what is audited

Adding a table to the audit set takes three coordinated edits — the role gate
will fail the build if you do the first without the others:

1. A new migration (`npm run db:generate`, then hand-append the trigger — see
   [Schema Changes](schema-changes.md)) adding
   `CREATE TRIGGER ... EXECUTE FUNCTION audit_row_change('<pk_column>')`.
   `TG_ARGV[0]` is the comma-separated primary-key column list.
2. Nothing in [`02-grants.sql`](../init-db/roles/02-grants.sql) — the
   `SECURITY DEFINER` function needs no privilege on the audited table. Only a
   new *view* needs a grant.
3. A test in `audit.test.ts` proving the rows appear with an actor.

Note that migration `0004_add_audit_log.sql` has been applied, so the trigger
function is now immutable: ship changes to it as a new migration with
`CREATE OR REPLACE FUNCTION`, never by editing `0004`.
