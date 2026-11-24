# Architecture decision records

Short records of decisions that are costly to reverse, so later sessions know why Finance Stack is
the way it is. Start each one from the ADR template in `~/.claude/dev_process/templates/adr.md`,
named `NNNN-kebab-case-title.md` and numbered in order. Never delete one: a decision that
changes gets a new record, and the old one becomes "Superseded by NNNN".

The first seven were backfilled on 2026-11-23 from the guides and issues that already recorded
them; each is dated when its decision was made.

| #    | Decision                                                                                                                                     | Status   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 0001 | [Authored Drizzle migrations are the schema's source of truth](0001-drizzle-migrations-are-the-schema-source-of-truth.md)                    | Accepted |
| 0002 | [Each service connects as its own least-privilege role](0002-each-service-connects-as-its-own-least-privilege-role.md)                       | Accepted |
| 0003 | [Database triggers write the audit log](0003-database-triggers-write-the-audit-log.md)                                                       | Accepted |
| 0004 | [Releases ship GHCR images and a deploy bundle, with a migration marker for rollback](0004-releases-ship-ghcr-images-and-a-deploy-bundle.md) | Accepted |
| 0005 | [Errors are captured server-side, through reportError(), without an SDK](0005-errors-are-captured-server-side-without-an-sdk.md)             | Accepted |
| 0006 | [Balance rebuilds lock each account, in ascending id order](0006-balance-rebuilds-lock-each-account-in-id-order.md)                          | Accepted |
| 0007 | [Recurring transactions run in-process, on Postgres's "today"](0007-recurring-transactions-run-in-process-on-postgres-today.md)              | Accepted |
