# 0002. Each service connects as its own least-privilege role

Date: 2026-07-26 · Status: Accepted · Issue: #130

## Context

Until [Issue #130](https://github.com/aellington89/finance-stack/issues/130), the app, the importer
and Metabase all connected as the PostgreSQL superuser, and Postgres and Metabase listened on every
interface. A flaw in any one service could read or rewrite everything, including the audit trail
that came later. Recorded on 2026-11-23 from
[database.md](../database.md#roles--privileges) and the issue.

## Decision

The services that serve requests or read data (`finance-app`, `importer`, Metabase and GlitchTip)
never connect as the superuser. Each one authenticates as its own login role, scoped to what it
does:

| Role                                      | Service                               | Can                                                                  |
| ----------------------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `finance_app`                             | `finance-app`                         | Read and write the core tables; only read `users` and `audit_log`    |
| `finance_importer`                        | `importer`                            | Append to `transactions` and `import_log`; read accounts and lookups |
| `finance_bi`                              | `metabase` (`bi`)                     | Read the core tables and views, never `users` or `audit_log` (#249)  |
| `MB_DB_USER` (default `metabase_user`)    | `metabase` (`bi`), its own state      | Own the separate Metabase database only (#239)                       |
| `GLITCHTIP_DB_USER` (default `glitchtip`) | `glitchtip` (`errors`), its own state | Own the separate GlitchTip database only (#232)                      |

The superuser is the maintenance identity: only the one-shot `migrate` and `init-script` jobs and
`pg-backup` use it. `migrate` creates the roles and re-applies their attributes, passwords and
grants on every run (`init-db/roles/`). Postgres, Metabase and GlitchTip publish their ports on
`127.0.0.1` only, and so does `finance-app` on a server (`deploy/compose.yml`); the development
`docker-compose.yml` publishes `finance-app` on every interface, and Caddy (`edge`) publishes 80
and 443 on purpose.

## Consequences

- A compromised app can't change the schema or forge audit rows
  ([0003](0003-database-triggers-write-the-audit-log.md)).
- `finance_app` is granted broadly and then revoked, with `ALTER DEFAULT PRIVILEGES`, so a new
  table is covered automatically. The two narrow roles are enumerated, so a migration that adds a
  table or view they need must also update `init-db/roles/02-grants.sql`.
- `assert-grants.sql` checks the grant matrix against the catalog. It fails any login role with a
  cluster attribute (`SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`), and any role
  the stack doesn't declare that has `CONNECT` on the database. CI runs it on every PR against a
  fresh `Finances_Test`; nothing runs it against a live install, so an operator who wants a server
  checked runs `scripts/verify-db-roles.sh` there
  ([Verifying the roles](../database.md#verifying-the-roles)). `migrate` never rewrites a role the
  stack doesn't declare.
- `migrate` can't converge the superuser's own password, because it authenticates with it; it
  detects a mismatch and reports it instead (Issue #189).

## Alternatives considered

- **One shared superuser for every service.** That was the state before #130. #130 went straight
  to a role per service, and recorded no other option.
