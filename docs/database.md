# Database

Covers the schema, views, balance-history table, first-launch initialization, the service roles and their privileges, and the test database.

## Schema

| Table | Description |
|---|---|
| `accounts` | All financial accounts (checking, savings, credit cards, loans, etc.) |
| `account_type_categories` | Top-level account categories (e.g. Current Asset, Current Liability) |
| `account_types` | Specific account types (e.g. Checking, Mortgage, Credit Card) |
| `transactions` | Individual financial transactions |
| `transaction_categories` | Expense/income categories (e.g. Groceries, Salary, Rent) |
| `transaction_types` | Transaction classifications (e.g. Debit, Credit, Transfer) |
| `account_balance_history` | Daily cumulative balance snapshots per account |
| `users` | Sign-in accounts (see [Authentication](auth.md)) |
| `audit_log` | Who changed what, with before/after row state. Written **only** by a database trigger, never by the app — see [Audit Log](audit-log.md) |

## Views

| View | Description |
|---|---|
| `v_transactions_full` | Fully joined transaction view with account names, types, categories, and related account info |
| `v_account_balances_current` | Current balance per account with full classification hierarchy (type, category) |
| `v_daily_totals` | Daily transaction totals grouped by transaction type (for income/expense line charts) |
| `v_audit_log` | The audit trail, flattened for reading. The only audit object the BI role can reach |

## Balance History

`account_balance_history` stores daily cumulative balances for each account, filling in days with no transactions with a zero daily change.

For the production `Finances` database, the rebuild script is behind a profile and does not run automatically. To run it:

```bash
docker compose --profile init run --rm init-script
```

The `Finances_Test` database has its balance history built automatically as part of the first-launch seed (see below).

## First-Launch Database Initialization

On the first `docker compose up` (empty Postgres data volume), [`init-db/01-create-databases.sh`](../init-db/01-create-databases.sh) runs once inside the postgres container and creates the `Finances` and `Finances_Test` databases plus the Metabase role + database. It does not apply any schema or seed data.

Schema and seeding then come from the `migrate` Compose service, which runs after postgres is healthy. The migrate service:

1. Creates the least-privilege service roles, then applies pending Drizzle migrations from [`app/drizzle/migrations/`](../app/drizzle/migrations/) to both `Finances` and `Finances_Test` and grants each role its privileges — see [Roles & Privileges](#roles--privileges).
2. Seeds the **app-owned reference rows** (all of `account_type_categories` and `transaction_types`, plus the single `transaction_categories` row id 6 `Other`) into both databases so they start in sync — see [Seed-data taxonomy](#seed-data-taxonomy) for why that one category row ships and the rest do not. This runs on **every** migrate run, not only on an empty database: the seed is purely additive (`ON CONFLICT DO NOTHING`, `setval`, and `UPDATE`s guarded by `WHERE liquidity_class IS NULL`), so **existing Finances user data is never overwritten** and a reference row added to the seed after your database was first created is backfilled automatically. See [Repairing seed drift](#repairing-seed-drift).
3. Seeds `Finances_Test` with mock data: all 19 `account_types`, 44 `transaction_categories`, 8 accounts, and ~400 transactions spanning the past 12 months relative to `CURRENT_DATE` at seed time.
4. Rebuilds `Finances_Test.account_balance_history` so balances are up-to-date as of today.

`finance-app` and `importer` wait on `migrate: service_completed_successfully` before starting. After the migrate service exits, a fresh `Finances` contains only the shared lookups and is ready for the user (or the importer) to populate via normal application use; an existing `Finances` has its lookups reconciled against the current seed and is otherwise untouched. `Finances_Test` contains a full year of mock activity usable by integration tests and for UI development.

### Repairing seed drift

`GET /api/health/seed-data` returns `503` with `"seedData": "drift"` when a row the application depends on by ID is missing or renamed:

```json
{"status":"error","db":"connected","seedData":"drift",
 "drift":[{"table":"transaction_types","id":12,"expected":"Opening Balance","actual":null}]}
```

`actual: null` means the row is **absent**; a string means it was **renamed**.

This endpoint **requires sign-in** — open it in a browser where you already have a session, or it answers `401`. It is a diagnostic you reach for, not a probe: it was split out of `/api/health` in Issue #191, so **seed drift no longer marks the `finance-app` container unhealthy**. Container health now follows liveness alone, because drift is a data problem that restarting cannot fix. Drift still matters — the affected code paths misbehave until you repair it — but you will learn about it from this endpoint rather than from Docker.

For any row that ships in `shared-lookups.sql`, re-running the migrate service is the fix — it re-applies the seed and backfills whatever is missing, without touching your data:

```bash
docker compose run --rm migrate
docker compose up -d --force-recreate finance-app
```

Until Issue #187 this could not self-heal: the Finances seed was skipped whenever the database held any accounts or transactions, so a populated database never received a reference row added later. That is why production ended up permanently missing `transaction_types` id 12 (`Opening Balance`) — the row the opening-balance path writes on every account created with an initial balance.

One case the re-run does *not* cover:

- **A renamed row.** The seed is `ON CONFLICT DO NOTHING`, so it will not rename a row back. Rename it in the UI, or `UPDATE` it to the name in [`app/lib/constants/reference-ids.ts`](../app/lib/constants/reference-ids.ts).

  This is most likely to bite on **`transaction_categories` id 6 `"Other"`**, because `/settings/categories` used to offer that row for editing like any other. Since Issue #178 it ships in `shared-lookups.sql`, so a fresh install has it and no longer reports drift; since Issue #109 it is protected, so it cannot drift again. If you renamed it before that landed, re-running migrate leaves your name in place — the repair is to rename it back in the UI, which is deliberately the one edit protection still allows (see [Protected rows](#protected-rows)).

If you need to repair a database you cannot restart the stack for, the seed's own statement is safe to run by hand:

```sql
INSERT INTO transaction_types (transaction_type_id, transaction_type)
OVERRIDING SYSTEM VALUE VALUES (12, 'Opening Balance')
ON CONFLICT (transaction_type_id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('transaction_types', 'transaction_type_id'),
              GREATEST((SELECT MAX(transaction_type_id) FROM transaction_types), 1));
```

### Editing the shared seed

Because `shared-lookups.sql` is now applied to the live database unconditionally, its idempotency is load-bearing. Every statement in it must be additive and safe to re-run: `INSERT … ON CONFLICT DO NOTHING`, `SELECT setval(…)`, `UPDATE … WHERE <guard>` — no `DELETE`, `TRUNCATE`, `DROP`, `ALTER`, `ON CONFLICT DO UPDATE`, or unguarded `UPDATE`. `npm run check:seed-references` enforces that list on every PR, and CI additionally proves the behaviour end-to-end against a populated throwaway database (the "Reference backfill gate").

## Seed-data taxonomy

*Added in Issue #178.* Every lookup row in this database sits somewhere on two independent axes, and where it sits determines which files it belongs in.

1. **Ownership** — does the row **ship with the application** (seeded, the same on every install), or is it **the user's** (created and edited through the UI)?
2. **Coupling** — does code depend on that **specific row** by id or name, or is it just data the user sees?

| | Ships with the app | The user's |
|---|---|---|
| **Code depends on the specific row** | **App-owned reference.** Belongs in `shared-lookups.sql` *and* `SEED_REFERENCES`. | ⚠️ **Not a category — a defect.** Code cannot hard-depend on a row the user may rename or delete. |
| **Code doesn't** | Convenience seed. Optional, and rare — if nothing depends on it, ask why it ships at all. | Pure user data. No seed, no health check. |

The top-right cell is the one that matters. It is not a bucket you file things in; it is a bug report. Anything that lands there gets resolved one of two ways: **ship the row** (move it left) or **stop depending on it** (move it down).

**Where each table sits today:**

| Table / rows | Bucket | Notes |
|---|---|---|
| `transaction_types` (12 rows) | App-owned reference | Seeded; health-checked |
| `account_type_categories` (6 rows) | App-owned reference | Seeded; health-checked |
| `transaction_categories` id 6 `Other` | App-owned reference | The only category that ships — `createAccount()` writes it on every account opened with an initial balance |
| `transaction_categories` — all other rows | Pure user data | Includes the ~15 the Liabilities drilldown reads, which opt in via `reporting_role` rather than by being named in code — see below |
| `account_types` rows | Pure user data | `liquidity_class` gets a seeded *default* per known name, via `UPDATE … WHERE liquidity_class IS NULL`, but the rows are yours |

**The case that used to be unresolved.** The Liabilities drilldown filtered on specific `transaction_category_id` values to identify debt payments and accrued interest. Those rows are user data — whether you carry a HELOC is your business — but the queries treated them as app-owned reference data, which put them squarely in the top-right cell. Shipping them was rejected: it would bake one person's loan portfolio into every install and still leave the set unextensible without a code change.

**Issue #111 resolved it by moving the row down, not left.** `transaction_categories` now carries a nullable `reporting_role`, and the aggregates filter on that column instead of on a list of ids. The meaning is an application concept the code owns; *which* categories carry it is the user's answer, given in `/settings/categories` and read at query time. A category you add and tag today is counted today. A fresh install has none tagged and reports zeros — which is now correct rather than a symptom, because it has no debt categories either.

### Reporting roles

*Added in Issue #111.* A reporting role is what a transaction category **means** to an aggregate, stored on the row rather than inferred from its id or name.

| Role | What it tags |
|---|---|
| `debt_principle_paid` | The principal portion of a loan payment, posted on the liability account |
| `debt_interest_paid` | The interest portion of a loan payment, posted on the liability account |
| `debt_interest_accrued` | Interest charged to the balance rather than paid — accrued loan interest, or a credit-card finance charge |
| `debt_cash_paydown` | A payment reducing the balance without a principal/interest split, e.g. a credit-card applied credit |

Declared in [`lib/constants/reporting-roles.ts`](../app/lib/constants/reporting-roles.ts), which every consumer reads — the query layer, the settings UI, the CI gate and this table's contents.

**Keys are namespaced by domain** (`debt_*`) and the column is `reporting_role`, not `liability_role`. Nothing about the mechanism is liability-specific: a future metric wanting `income_interest_earned` or `investment_dividend` adds a registry entry and a migration widening the CHECK, with no collision and no rename. Only the `debt` domain ships today, deliberately — a role no query reads would be a permitted value that means nothing.

**Only `transaction_categories` carries the column.** `transaction_types` and `account_type_categories` ship with the application, so code naming a specific row of theirs by id is legitimate under the taxonomy rather than a defect. Adding the column there would be a column nothing reads.

**The role set is written twice, and gated.** It appears in the registry and again in the `CHECK` constraint in [`drizzle/schema.ts`](../app/drizzle/schema.ts). Generating one from the other would need `sql.raw`, which `eslint.config.mjs` bans repo-wide — so `npm run check:seed-references` proves the two equal in both directions instead, the same posture `SHIPPED_ROWS` has against `shared-lookups.sql`. A role in the registry but not the constraint is a value the UI offers and the database rejects; one in the constraint but not the registry is a value the database accepts that no query reads.

**Upgrading an existing install.** Migration `0005` backfills the roles onto the fifteen categories the old pinned lists named, matched on **id and name together** — the same self-limiting rule row protection uses, so an install where id 7 is somebody's "Coffee" category is left alone. The backfill lives in the migration rather than in `shared-lookups.sql` on purpose: that file re-runs on every `docker compose up`, where an `IS NULL` guard would silently put a role back on a category you had deliberately cleared. Categories the backfill did not match stay untagged and can be tagged in `/settings/categories`.

### Protected rows

*Added in Issue #109.* The taxonomy above says which rows the application owns. Protection is what stops the UI handing them to the user anyway: `/settings/categories` renders a lock instead of the edit and delete buttons, and the server actions in [`lib/actions/categories.ts`](../app/lib/actions/categories.ts) refuse the same rows so a crafted form submit gets no further.

One rule, in [`lib/constants/protected-rows.ts`](../app/lib/constants/protected-rows.ts):

| Rule | Matched on | Rows |
| --- | --- | --- |
| **App-owned** | id | Every row `shared-lookups.sql` ships — all 12 `transaction_types`, all 6 `account_type_categories`, `transaction_categories` id 6. Declared as `SHIPPED_ROWS` in [`reference-ids.ts`](../app/lib/constants/reference-ids.ts). |

**Shipping is the criterion, not being named by code.** `transaction_types` id 3 `Refund` is in no `SEED_REFERENCES` group and no query pins it, but it arrives identically on every install and renaming it buys nothing but divergence. `SEED_REFERENCES` stays the narrower "code depends on this specific row" list that drives the health check; `SHIPPED_ROWS` is a superset of it.

**There used to be a second rule, and Issue #111 removed it.** *Liability pin* locked the ~15 `transaction_categories` rows the Debt Service and Debt Waterfall queries named by id — matched on id **and** current name, so that protection was self-limiting on an install where those ids held unrelated rows. It existed only because the queries had no better handle on those rows. Now that `reporting_role` carries the meaning, renaming "Mortgage Principle" drops it out of nothing, so there is nothing left to protect it from. **Those fifteen categories are fully editable and deletable again** — they are the user's rows, which is what the taxonomy always said they were.

**Renaming back is always allowed.** The rule is "the name must equal the canonical name", not "this row is frozen". An install that renamed id 6 before this landed keeps that name, and a blanket refusal would strand `/api/health/seed-data` at 503 with no way out of the UI. The only rename protection permits is the one that restores the shipped name. Deletes are refused outright.

**It is an application guard, not a database one.** A `BEFORE UPDATE OR DELETE` trigger was considered and rejected: [`vitest-setup.ts`](../app/tests/integration/vitest-setup.ts) re-converges these rows with `ON CONFLICT DO UPDATE`, and the manual `UPDATE` above is the documented repair path. Both are legitimate, and a trigger would break them to stop a mistake nobody makes through `psql`.

`transaction_types` is not on `/settings/categories` at all. Issue #109 removed the Add button and deleted `createTransactionType` rather than guarding it, because a thirteenth type created there is a row nothing in the codebase would recognise — which left a card rendering twelve padlocks and offering no action, since every row the table ships is protected. Rows an install created past id 12 before that are untouched and still editable, on the admin page below.

**Where both tables live now.** [Issue #87](https://github.com/aellington89/finance-stack/issues/87) moved `transaction_types` and `account_type_categories` whole to `/settings/admin`, which requires `role = 'admin'`; `account_type_categories` had never had a card on `/settings/categories` in the first place. Both are the basis of every KPI, so a wrong edit is not one bad row but every dashboard at once — see [Roles](auth.md#roles) for why the split lands there rather than on the whole settings page.

Protection and the role gate answer different questions and are not redundant. Protection says *this row ships with the app* and applies to everyone including admins; the role gate says *this table is reference data* and covers the rows protection cannot know about — the ones an install minted for itself past the shipped range. `transaction_types` update and delete were briefly gated on session alone, on the reasoning that protection already refused all 12 shipped rows so only a self-minted row was reachable. That had the sign backwards: a self-minted row is exactly the user-owned reference data the KPI classification depends on.

### Adding a new reference row

If code will depend on the row:

1. Add it to [`init-db/seeds/shared-lookups.sql`](../init-db/seeds/shared-lookups.sql), following the [contract above](#editing-the-shared-seed).
2. Add a constant for it in [`app/lib/constants/reference-ids.ts`](../app/lib/constants/reference-ids.ts) and list it in the matching `SEED_REFERENCES` group.
3. Add it to the matching `SHIPPED_ROWS` group in the same file. Every shipped row belongs there, whether or not code names it — that is what makes it [protected](#protected-rows).
4. Run `npm run check:seed-references`. It fails if any of the three disagree — including if you reference a table the seed does not populate at all, which is how the id-6 gap survived four releases, and if you ship a row `SHIPPED_ROWS` does not list, which would reach every install editable.

If it is a fixture row that only tests need, it goes in [`init-db/seeds/finances-test-mock-data.sql`](../init-db/seeds/finances-test-mock-data.sql) — not in `vitest-setup.ts`, and not in `shared-lookups.sql`. See [Testing](testing.md).

**Three sources, one direction.** `transaction_categories` is defined in three places, and the gate keeps them pointing the same way rather than letting them drift:

```
shared-lookups.sql          finances-test-mock-data.sql
  (app-owned: id 6)           (Finances_Test fixture rows)
        ▲                              ▲          ▲
        │ SEED_REFERENCES              │ every    │ must be a subset of
        │ must match                   │ role     │ (it is drift-correction,
        │                              │ covered  │  not a definition)
  reference-ids.ts          reporting-roles.ts      vitest-setup.ts
```

> **Do not add a column to those `INSERT` blocks.** The gate's parser reads
> `(<id>, '<name>')` tuples and nothing else, so a third column does not raise an
> error — every row in the block stops matching, the block parses to zero rows,
> and three of the checks above pass over an empty set while reporting success.
> Carry extra columns in a separate `UPDATE`, as the `reporting_role` assignments
> do. `npm run check:seed-references` now fails on an unreadable block rather
> than relying on this paragraph being read.

### Adding a reporting role

Roles are declared as data, so a new one is two edits and a gate run:

1. Add the entry to `REPORTING_ROLES` in [`app/lib/constants/reporting-roles.ts`](../app/lib/constants/reporting-roles.ts) — key (namespaced by domain), label and description. The label and description are what `/settings/categories` renders.
2. If an aggregate should read it, add it to the relevant group constant in the same file (e.g. `DEBT_PAYMENT_ROLES`). A role in no group is a tag the UI offers that no query reads.
3. Widen the `CHECK` on `transaction_categories` in [`app/drizzle/schema.ts`](../app/drizzle/schema.ts), then `npm run db:generate -- --name <description>` so a migration carries it.
4. Tag at least one category with it in [`init-db/seeds/finances-test-mock-data.sql`](../init-db/seeds/finances-test-mock-data.sql), via a separate `UPDATE` — the gate requires it, because an aggregate reading a role no fixture row carries is one the integration suite cannot tell apart from zero.
5. Run `npm run check:seed-references`. It fails if the registry and the CHECK disagree in either direction, or if a role has no fixture coverage.

A role for a **new domain** (assets, income) is the same five steps; nothing is liability-specific. What it additionally needs is a query that reads it — a permitted value no aggregate consumes is the "convenience seed" cell of the taxonomy, and the question to ask is why it exists.

## Roles & Privileges

The long-running services do **not** connect as the `postgres` superuser (Issue #130). Each authenticates as its own login role, scoped to what it actually does:

| Role | Used by | Privileges |
|---|---|---|
| `finance_app` | `finance-app` | `SELECT`/`INSERT`/`UPDATE`/`DELETE` on every table **except `users` and `audit_log`, which are `SELECT`-only**; `SELECT` on the views; `USAGE` on the sequences |
| `finance_importer` | `importer` | `SELECT` + `INSERT` on `transactions`; `SELECT` on `accounts`, `transaction_categories`, `transaction_types`. No `UPDATE`, no `DELETE` |
| `finance_bi` | Metabase's Finances connection | `SELECT` on the seven core base tables and the four views. **Nothing on `users` or `audit_log`**, and no write anywhere |

**What `finance_bi` deliberately does *not* get is `users` and `audit_log`.** Reusing `finance_app` would have served the same questions — it already holds `SELECT` on everything — but it can read `users.password_hash`, and Metabase permits native SQL, so hiding a table in its admin UI is a display setting rather than a privilege boundary (Issue #249).

A stricter role, `finance_metabase`, held `SELECT` on the four views and nothing else. It was retired in Issue #250: it could not serve questions built directly on `transactions` or `account_balance_history` — and the latter has no view over it at all — so in the whole time it existed nothing was ever pointed at it. Two near-identical credentials for one job is how an operator wires up the wrong one. Getting back to a views-only posture means writing the missing views first; that is the #249 follow-up.

None of them is a superuser, none can create databases or roles, and none has `CREATE` on schema `public` — so no service can add, alter, drop, or truncate a table, and none can reach the `drizzle` migration ledger. Tables stay owned by `POSTGRES_USER`, which is what makes that true.

### Every login role in the cluster

Those three are not the whole story, and describing only them is how a **superuser `metabase_user` went unnoticed** (Issue #239). The full set of roles that can log in:

| Role | Used by | Privilege level |
|---|---|---|
| `finance_app`, `finance_importer`, `finance_bi` | the long-running services and the BI connection | the matrix above |
| `MB_DB_USER` (default `metabase_user`) | Metabase, for its **own metadata database** | Owns `MB_DB_DBNAME` and holds `USAGE`+`CREATE` on its `public` schema — it runs its own schema migrations there. **No cluster attributes, and no `CONNECT` on `Finances`** |
| `POSTGRES_USER` (default `postgres`) | `migrate`, `init-script`, `pg-backup` | Superuser, deliberately — these are maintenance jobs that need DDL and cluster-wide reads, and none has a network-facing surface |

**Exactly one login role is a superuser, and it is the maintenance identity.** That is now an assertion rather than a description: [`assert-grants.sql`](../init-db/roles/assert-grants.sql) sweeps *every* login role in `pg_roles`, exempting only `current_user` — the identity running the gate. A role added later, by a future service or by hand, fails the gate by default instead of being invisible to it, and a role the stack does not declare must additionally hold no `CONNECT` on the database under test.

> Because the exemption is `current_user`, the gate **must be run as the maintenance superuser** or it asserts something subtly different. Every caller already does: CI sets `PGUSER=postgres`, and `verify-db-roles.sh` inherits the `migrate` service's.

### The Metabase metadata database

`MB_DB_USER` is not one of the `finance_*` service roles and is easy to overlook, because it never touches `Finances`. It exists so Metabase can store its own state — questions, dashboards, users, its Quartz job scheduler — in a separate database, and Metabase runs **its own Liquibase migrations against that database at startup**.

That is the whole of what it needs, and it is not superuser:

- **ownership of `MB_DB_DBNAME`**, plus `USAGE` and `CREATE` on its `public` schema, so its startup migrations can create and alter its tables;
- **nothing else** — no `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION` or `BYPASSRLS`, and no access to `Finances` at all.

`PUBLIC` also lost the default `CONNECT`/`TEMPORARY` on that database, which every role in the cluster held until #239 — the same revoke `02-grants.sql` has always applied on the `Finances` side. It holds Metabase's own user table, so it is not a database other services should be able to open a session on.

Order matters if you ever change this: **establish ownership first, strip attributes last**. A role de-privileged before it owns its metadata database cannot migrate it, and the failure surfaces at Metabase's next start rather than in any catalog check — which is why [`verify-db-roles.sh`](../scripts/verify-db-roles.sh) connects as the role and creates a table, and why the change was verified against a running Metabase under `--profile bi`.

Two details worth knowing before you change any of this:

- **The views work without base-table access** because they are created without `security_invoker`, so they execute with the view *owner's* rights. `SELECT` on the view is sufficient on its own. This is what made the retired views-only `finance_metabase` possible, and it still matters: add `security_invoker` to a view and any role reading it needs privileges on the base tables too.
- **`finance_app` is granted broadly and then revoked** (`GRANT … ON ALL TABLES`, then `REVOKE … ON users` and `REVOKE … ON audit_log`) plus `ALTER DEFAULT PRIVILEGES`, so a table added by a future migration is covered automatically. The `audit_log` revoke is what makes the audit trail worth having: the app still *causes* audit rows, because the trigger that writes them is `SECURITY DEFINER` and runs with the table owner's rights, but it cannot forge or delete one ([Audit Log](audit-log.md)). The two narrow roles are enumerated instead — if a migration adds a table or view they need, [`init-db/roles/02-grants.sql`](../init-db/roles/02-grants.sql) must be updated by hand.

### How the roles are applied

Roles and grants are applied by the **`migrate` service** on every `docker compose up`, not by `init-db/01-create-databases.sh`. Two reasons: that script only runs on an empty data directory, so an existing Postgres volume would never gain the roles; and a `GRANT` names tables, so it can only run after migrations have created them.

| File | Purpose |
|---|---|
| [`init-db/roles/01-create-roles.sql`](../init-db/roles/01-create-roles.sql) | Creates the three login roles (cluster-global, so it runs once per migrate run) |
| [`init-db/roles/02-grants.sql`](../init-db/roles/02-grants.sql) | Applies the matrix above to one database; run against `Finances` and `Finances_Test` |
| [`init-db/roles/03-metabase-role.sql`](../init-db/roles/03-metabase-role.sql) | Converges the Metabase metadata role — attributes, ownership, and its password; run against `MB_DB_DBNAME` (Issues #239, #189) |
| [`init-db/roles/assert-grants.sql`](../init-db/roles/assert-grants.sql) | Asserts the matrix against the catalog — the CI grant gate |

`02-grants.sql` **revokes before it grants**, inside a transaction, so it converges: a privilege widened by hand is removed on the next `up`, and there is no window in which a running app has no access. `01-create-roles.sql` and `03-metabase-role.sql` converge the same way, with an unconditional `ALTER ROLE`.

**One story about out-of-band changes, applied everywhere:** the stack silently converges what it *declares* — the three service roles and the Metabase metadata role, attributes and passwords alike — and refuses to be silent about anything else. A login role the stack does not declare is never rewritten by `migrate`; it fails `assert-grants.sql` instead, so an operator who added one deliberately gets told rather than quietly overruled. `POSTGRES_PASSWORD` sits in that second category by necessity rather than by choice: `migrate` cannot converge the credential it authenticates with, so it detects the divergence and reports it instead (Issue #189).

### Verifying the roles

[`scripts/verify-db-roles.sh`](../scripts/verify-db-roles.sh) checks both layers — the catalog matrix, then a behavioural smoke that connects as each role and asserts that permitted statements succeed and forbidden ones are refused with `SQLSTATE 42501`. Writes are rolled back, so it is safe against a populated database:

```bash
docker compose run --rm --entrypoint bash migrate /scripts/verify-db-roles.sh Finances
```

The `migrate` service already carries every variable the script needs, so no `-e` flags are required. CI runs the same script against `Finances_Test` on every PR, and follows it with a **negative check** that widens a role on purpose and asserts the gate rejects it — a gate that cannot fail proves nothing, and this one reported OK for months while a superuser sat beside the roles it was checking.

The metadata-role cases need `MB_DB_PASS` and are skipped with a `skip` line without it; the catalog gate still covers that role's attributes either way. They are also what keeps the rest honest: a connection that never opens now fails the case it appears in, so a wrong password can no longer pass an `allow` case by simply never reaching the statement.

That this script *skips* without `MB_DB_PASS` while `migrate` *requires* it is not a contradiction. `migrate` requires it only when the metadata database exists, because at that point it is setting the password rather than using it; this script can be pointed at any cluster by hand, and refusing to run at all would be worse than covering one role less.

### Rotating a role password

**Four of the five rotate from `.env` alone. One does not, and cannot.**

| Credential | Rotate by | Then restart |
|---|---|---|
| `FINANCE_APP_DB_PASSWORD` | editing `.env` | `finance-app` |
| `FINANCE_IMPORTER_DB_PASSWORD` | editing `.env` | `importer` |
| `FINANCE_BI_DB_PASSWORD` | editing `.env` | nothing — re-enter it by hand in the Metabase admin UI |
| `MB_DB_PASS` | editing `.env` | `metabase` (`--profile bi`) |
| `POSTGRES_PASSWORD` | **`\password` first, then `.env`** — see below | everything |

For the first four, edit the value and re-run the migrate service. `01-create-roles.sql` and `03-metabase-role.sql` both issue an unconditional `ALTER ROLE … PASSWORD`, so the new value takes effect with no manual SQL:

```bash
docker compose run --rm migrate
docker compose up -d --force-recreate finance-app importer
```

Passwords are interpolated into URL-form connection strings, so keep them URL-safe or percent-encode them.

#### Why `POSTGRES_PASSWORD` is different

Not an oversight, and not something a future change can fix by adding another `ALTER ROLE`. The Postgres image applies `POSTGRES_PASSWORD` only through `initdb --pwfile`, inside a branch the entrypoint skips once `$PGDATA/PG_VERSION` exists — so editing it on an existing volume changes nothing. The service roles escape that trap because `migrate` re-asserts them, but **`migrate` authenticates *as* the superuser**. The moment `.env` and the stored password disagree, it cannot connect, so an `ALTER` it would have issued never runs. Re-asserting the superuser password on every `up` would be dead code on the one occasion it mattered (Issue #189).

So the order is inverted: alter the role **first**, then update `.env`.

```bash
docker compose exec postgres psql -U postgres    # then: \password postgres
# set POSTGRES_PASSWORD in .env to the same value
docker compose up -d --force-recreate
```

Get it backwards and the stack fails loudly rather than subtly. [`app/scripts/preflight-superuser.sh`](../app/scripts/preflight-superuser.sh) runs before anything else in the migrate job and turns what used to be a bare `password authentication failed` into the procedure above. `init-script` and `pg-backup` authenticate with the same credential, so they fail alongside it.

### Pointing Metabase at a least-privilege role

Metabase stores its analytics connections in its own metadata database, not in environment variables, so this cannot be wired through `docker-compose.yml` — it is a one-time manual step. In Metabase, go to **Settings → Admin → Databases → your Finances database**, change the username and password, and save.

**Check what it is set to before assuming.** Being a manual step, it is the one part of the least-privilege work that a `docker compose up` cannot apply and no gate can see — and on this deployment it had never been performed. The connection was still the `postgres` superuser long after #130 landed, while this page said otherwise (Issue #249). To read the current value:

```bash
docker compose exec postgres psql -U postgres -d metabase \
  -c "SELECT id, name, details::json ->> 'user' AS db_user FROM metabase_database;"
```

Use **`finance_bi`**, with `FINANCE_BI_DB_PASSWORD`. It is the one role for this job (Issue #250) — it cannot read `users` or `audit_log`, and cannot write.

**Do not use `finance_app` here**, tempting though it is when a question fails on a missing table: it can read `users.password_hash`, and Metabase permits native SQL, so hiding the table in the admin UI does not contain it.

`MB_DB_USER` is a different role and is not what you are editing here — it owns Metabase's *internal* metadata database and has no access to `Finances`. This page used to add "and was never the superuser," which was **wrong**: on the live cluster it carried `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION` and `BYPASSRLS`, widened out-of-band with nothing in the repository recording it. See [Every login role in the cluster](#every-login-role-in-the-cluster) for what it holds now and what asserts it (Issue #239).

## Test Database

`Finances_Test` is populated automatically on first launch — no manual seeding is required. The seed artifacts live in [`init-db/seeds/`](../init-db/seeds/) and are applied by the `migrate` Compose service:

| File | Purpose |
|---|---|
| `shared-lookups.sql` | 6 account type categories + 12 transaction types + the one app-owned transaction category (id 6 `Other`), plus `account_types.liquidity_class` defaults for the known asset type names (runs against both DBs, on every migrate run) |
| `finances-test-mock-data.sql` | 19 account types, 44 categories, 8 accounts, ~400 transactions with dates derived from `CURRENT_DATE` |
| `rebuild-balance-history.sql` | Mirrors `scripts/update-account-balance-history.sql`, runs against `Finances_Test` at seed time |

### Refreshing Finances_Test (dates age out)

The mock transaction dates are evaluated once, at seed time. If they drift out of the "past 12 months" window, drop and re-seed the test database:

```bash
# 1. Drop and recreate Finances_Test
docker exec postgres psql -U postgres -c 'DROP DATABASE IF EXISTS "Finances_Test";'
docker exec postgres psql -U postgres -c 'CREATE DATABASE "Finances_Test";'

# 2. Re-run the migrate service (applies migrations + reseeds Finances_Test)
docker compose run --rm migrate
```

For schema changes, see [Making schema changes](schema-changes.md) — never edit the database by hand.
