# 0002. Each service connects as its own least-privilege role

Date: 2026-07-26 · Status: Accepted · Issue: #130

## Context

Until [Issue #130](https://github.com/aellington89/finance-stack/issues/130), the app, the importer
and Metabase all connected as the PostgreSQL superuser, and Postgres and Metabase listened on every
interface. A flaw in any one service could read or rewrite everything, including the audit trail
that came later. Recorded on 2026-11-23 from
[database.md](../database.md#roles--privileges) and the issue.

## Decision

The long-running services never connect as the superuser. Each one authenticates as its own login
role, scoped to what it does:

| Role               | Service                | Can                                                                 |
| ------------------ | ---------------------- | ------------------------------------------------------------------- |
| `finance_app`      | `finance-app`          | Read and write the core tables; only read `users` and `audit_log`   |
| `finance_importer` | `importer`             | Append to `transactions` and `import_log`; read accounts and lookups |
| `finance_bi`       | `metabase` (`bi`)      | Read the core tables and views, never `users` or `audit_log` (#249) |
| `metabase_user`    | `metabase`, own state  | Own the separate `metabase` database only (#239)                     |

The superuser is the maintenance identity: only the one-shot `migrate` job and `pg-backup` use it.
`migrate` creates the roles and re-applies their attributes, passwords and grants on every run
(`init-db/roles/`). Host ports bind to `127.0.0.1`.

## Consequences

- A compromised app can't change the schema or forge audit rows
  ([0003](0003-database-triggers-write-the-audit-log.md)).
- `finance_app` is granted broadly and then revoked, with `ALTER DEFAULT PRIVILEGES`, so a new
  table is covered automatically. The two narrow roles are enumerated, so a migration that adds a
  table or view they need must also update `init-db/roles/02-grants.sql`.
- `assert-grants.sql` is a CI gate: it checks the grant matrix against the catalog and fails on
  any undeclared login role, so a role added by hand is reported, not silently rewritten.
- `migrate` can't converge the superuser's own password, because it authenticates with it; it
  detects a mismatch and reports it instead (Issue #189).

## Alternatives considered

- **One shared superuser for every service.** That was the state before #130. #130 went straight
  to a role per service, and recorded no other option.
