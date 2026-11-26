# Finance Stack

A containerized personal finance data warehouse for aggregating, storing, and visualizing
multi-account financial data: PostgreSQL 18, a Next.js 16 app, a Python importer, and optional
Metabase, GlitchTip, and Caddy services, run with Docker Compose. Solo-developer project, built
with the shared dev process (Dev process, below).

## Commands

- `docker compose up`: the whole stack (README, "Getting Started"). `COMPOSE_PROFILES` in
  `.env` adds the optional services.
- In `app/`: `npm run dev`, `npm run dev:verify` (port 3003, beside the stack), `npm run lint`,
  `npm run typecheck`, `npm test` (Vitest), and `npm run test:e2e` (Playwright); the gates
  `npm run check:changelog`, `npm run check:docs`, `npm run check:seed-references`, and
  `npm run check:audit`; and `npm run db:generate -- --name <description>` for a migration
  (docs/schema-changes.md).
- In `importer/`: `pytest tests -v`.

## Where things are

- `app/`: the Next.js app, with Auth.js and Drizzle (`app/drizzle/` holds the migrations).
  `importer/`: file ingestion. `init-db/`: database initialization. `deploy/`: the release
  bundle. `caddy/` and `scripts/`: the edge proxy and the operations scripts.
- docs/README.md indexes the guides. CONTRIBUTING.md has the workflow and every CI gate.

## Conventions

- A shell check that reads an `.env` or `.env.example` value reads it as Compose does: the last
  `NAME=` line, with one pair of quotes stripped (`env_file_get` in `deploy/deploy.sh`, and the
  template check in `release.yml`'s boot step, Issue #260). Grep for an existing reader first.

- A write that changes several accounts rebuilds them with `rebuildAccountBalances`, which
  locks them in ascending id order; a hand-rolled loop over `rebuildAccountBalance` can
  deadlock (`app/lib/queries/rebuild-balance.ts`, Issue #463).
- "Today" for anything a save counts from is Postgres's `CURRENT_DATE`, read by the page, never
  the browser's date; a client that must notice the day turning uses the instant it ends
  (`getRecurringToday()` and `todayAsOf()`, Issue #135).
- An edit form for a row a background job also writes posts the value it loaded, so a form left
  open isn't read as an edit (`loadedNextRunDate` in `app/lib/actions/recurring-transaction.ts`).
- Account pickers list open accounts only. An edit form keeps the row's own closed account
  (`accountOptions` in `recurring-transaction-dialog.tsx`, `initialAccountValue` in
  `transaction-edit-row.tsx`); blanking it makes a save silently clear the link.
- ESLint's `react-hooks/purity` (React Compiler) rejects `Date.now()` in a function defined
  during render, even one only a click handler calls: read the clock in a helper it calls.
- An integration test that reads `audit_log` filters on a watermark from `maxAuditId()`, taken
  before the action; `row_pk` alone matches stale rows once a test database reuses ids
  (`app/tests/integration/audit-watermark.ts`, PR #486).
- A transaction read that needs no joined name reads `transactions`, not `v_transactions_full`,
  through the one `buildWhereClause(filters, source)`. It matches the view only while every
  inner join there follows a `NOT NULL` foreign key, which
  `app/tests/integration/queries/transactions.test.ts` checks (Issue #146).
- An integration test that compares whole tables fails if a `next dev` server (`npm run dev` or
  `npm run dev:verify`) on the same `Finances_Test` writes between its reads: stop it or start it
  with `RECURRING_SCHEDULER=off`.

## Dev process

@~/.claude/dev_process/CONVENTIONS.md

This project follows the shared development process in `~/.claude/dev_process` (from
`aellington89/dev_process`; the version of its synced files is in `.dev-process.json`). Its
additions, and where it differs from the shared process, are in `docs/PROCESS.md`. The skills
read these facts:

| Fact              | Value                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default branch    | `master`                                                                                                                                                                                                                                                                                |
| Verify            | In `app/`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run check:changelog`, `npm run check:docs`, and `npm run check:seed-references`; in `importer/`: `pytest tests`; in the root: `node scripts/dev-process/check-process.mjs`. CI runs every other gate (CONTRIBUTING.md) |
| Unit tests        | `npm test` in `app/`; `test:unit`, `test:jsdom`, and `test:integration` run one project each                                                                                                                                                                                            |
| End-to-end tests  | `npm run test:e2e` in `app/` (Playwright)                                                                                                                                                                                                                                               |
| Run the app       | `docker compose up`, or `npm run dev:verify` in `app/` beside it (port 3003; `npm run dev` on 3001 once `finance-app` is stopped; README)                                                                                                                                               |
| Format            | n/a: ESLint (`npm run lint` in `app/`) is the style gate; there's no formatter                                                                                                                                                                                                          |
| Next version      | `node scripts/dev-process/release.mjs next` in the root (docs/releases.md, "Choosing the bump")                                                                                                                                                                                         |
| Prepare a release | `node scripts/dev-process/release.mjs prepare` in the root, then the `**Migration:**` marker under the new heading and `npm version X.Y.Z --no-git-tag-version` in `app/`; `npm run check:changelog` holds them together (docs/releases.md)                                             |
| User guide        | README.md, and the guides that docs/README.md indexes                                                                                                                                                                                                                                   |
| Roadmap           | GitHub milestones named `Phase N — <theme>`, with the Projects board (https://github.com/aellington89/finance-stack/projects); a feature is `<N>.<n> · <name>` in its phase                                                                                                             |
| GitHub project    | https://github.com/users/aellington89/projects/24 ("Iterative Development - Finances Stack"; docs/PROCESS.md has its Priority and Size scales)                                                                                                                                          |
