# 0006. Recurring transactions run in-process, on Postgres's "today"

Date: 2026-11-22 · Status: Accepted · Issue: #135

## Context

[Issue #135](https://github.com/aellington89/finance-stack/issues/135) added recurring transaction
templates, which turn each due date into an ordinary `transactions` row, exactly once. Something
has to run them when nobody is saving, and every part of the app has to agree on which day it is.
The issue's first sketch put that job in the importer or in a Next.js cron route. Recorded on
2026-11-23 from [database.md](../database.md#recurring-transactions).

## Decision

- **The scheduler is a timer inside `finance-app`** (`lib/recurring/scheduler.ts`, started by
  `register()` in `instrumentation.ts`). It runs due templates about 30 seconds after start and then
  hourly, never overlapping. `RECURRING_SCHEDULER=off` turns it off. Saving a template also adds
  whatever is already due, in the same transaction.
- **"Today" is Postgres's `CURRENT_DATE`**, the same one every balance uses, read by the page and
  never taken from the browser.
- **Each occurrence exactly once:** the template is locked `FOR UPDATE` with the due test repeated,
  and a `UNIQUE` on `(recurring_transaction_id, recurring_occurrence_date)` makes a duplicate insert
  a no-op.
- **Dates count from the anchor,** never from the previous date, in pure UTC math held equal to
  Postgres's interval arithmetic by a test.

## Consequences

- No cron container, secret or URL. It runs whenever `finance-app` does, and
  `restart: unless-stopped` keeps that true.
- Because Postgres runs in UTC, the day turns over in the US evening, so a bill dated the 1st
  appears on the evening of the 31st. That is app-wide, and tracked as #482.
- A client that must notice the day turning uses the instant it ends (`getRecurringToday()`,
  `todayAsOf()`), and an edit form posts the next date it loaded, so a form left open isn't read as
  an edit (`loadedNextRunDate`).
- A dev server on `Finances_Test` writes on its own schedule, so whole-table integration tests need
  it stopped or started with `RECURRING_SCHEDULER=off`. `Finances_Test` seeds no templates for the
  same reason.

## Alternatives considered

- **A job in the importer** (#135's first sketch). `finance_importer` may only append to
  `transactions` and `import_log` ([0002](0002-each-service-connects-as-its-own-least-privilege-role.md)), so it
  couldn't advance a template's next date or rebuild the balances it touched.
- **A Next.js cron route** (the sketch's other option). Something outside would have to call it, so
  it needs a URL and a secret to guard it; the timer needs neither.
- **The browser's date.** It would let the page and the save disagree on "today" (CLAUDE.md).
