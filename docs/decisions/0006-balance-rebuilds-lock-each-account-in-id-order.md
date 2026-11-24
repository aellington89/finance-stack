# 0006. Balance rebuilds lock each account, in ascending id order

Date: 2026-11-21 · Status: Accepted · Issue: #463

## Context

`account_balance_history` holds each account's balance per day, and every create, edit or delete
rebuilds the history of the accounts it touched by summing the rows it can see.
[Issue #463](https://github.com/aellington89/finance-stack/issues/463) showed that two writes to one
account committing at the same moment could each sum from their own snapshot under READ COMMITTED,
so the later rebuild overwrote the other's totals, with no error. The recurring scheduler
([0007](0007-recurring-transactions-run-in-process-on-postgres-today.md)) writes on its own clock,
which makes that overlap likelier. Recorded on 2026-11-23 from
[database.md](../database.md) and the issue's plan.

## Decision

- Every rebuild the app runs (`rebuildAccountBalance`) first takes a per-account,
  transaction-scoped advisory lock,
  `pg_advisory_xact_lock(463001, account_id)`, as a statement of its own, so the rebuild that follows
  gets a fresh snapshot that includes the other writer's rows.
- A write that touches several accounts goes through `rebuildAccountBalances`, which takes the
  locks in ascending id order, so two writers can't deadlock.
- The wait is bounded: `lock_timeout` is 15 seconds for the lock statement only. Past that, the
  write fails with SQLSTATE 55P03, is reported, and keeps nothing.

## Consequences

- Concurrent saves to one account both count, and the failure mode is loud rather than silent.
- A new write path that changes several accounts must use `rebuildAccountBalances`; a hand-rolled
  loop over `rebuildAccountBalance` can deadlock (CLAUDE.md).
- The full rebuild run by hand (`init-script`, behind the `init` profile) doesn't take the lock yet,
  so a save during its run can be left out (#465).

## Alternatives considered

None were weighed: #463's plan went straight to the advisory lock. SERIALIZABLE isolation (with
retries) and a row lock on `accounts` are the obvious alternatives, so a change here should weigh
them first.
