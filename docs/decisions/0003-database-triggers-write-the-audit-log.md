# 0003. Database triggers write the audit log

Date: 2026-07-31 · Status: Accepted · Issue: #180

## Context

Once sign-in and roles landed (#120), knowing who changed what became a v1.0.0 gate.
[Issue #180](https://github.com/aellington89/finance-stack/issues/180) left open whether to write
audit rows from triggers in Postgres or from the server actions in `app/lib/actions/`. Recorded on
2026-11-23 from [audit-log.md](../audit-log.md#why-triggers-rather-than-application-code).

## Decision

A `SECURITY DEFINER` trigger function, `audit_row_change()`, owned by the superuser, writes one
`audit_log` row per inserted, updated or deleted row, with `to_jsonb(OLD)` and `to_jsonb(NEW)`. The
app names the actor out of band, through transaction-local settings that `auditedTransaction` sets.
Each audited table gets its trigger hand-appended to the migration that creates it.

## Consequences

- Every writer is covered: the app, the importer (which inserts as `finance_importer`), and anyone
  with `psql`.
- `finance_app` holds only `SELECT` on `audit_log`
  ([0002](0002-each-service-connects-as-its-own-least-privilege-role.md)), so a compromised app can
  cause audit rows but can't forge or delete one.
- Every column is captured without per-action upkeep, and a new column is captured automatically.
- `auditedTransaction()` (`app/lib/db/audited.ts`) is the only thing that sets the actor, so every
  mutating server action goes through it. A write outside it is still recorded, with a null
  `actor_user_id`, as the importer's are.
- A new table isn't audited until its migration adds the trigger, so auditing a table is a
  deliberate act ([Changing what is audited](../audit-log.md#changing-what-is-audited)).
- Tests that read `audit_log` filter on a watermark from `maxAuditId()`, because ids are reused
  across test runs (PR #486).

## Alternatives considered

- **Audit writes in each server action.** Blind to the importer and to `psql`, writable by the app
  it's meant to watch, and stale the moment a column is added.
