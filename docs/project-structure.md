# Project Structure

Repository layout and directory tree.

## Directory Tree

```
finance-stack/
├── docker-compose.yml                    # Infrastructure definition
├── .env.example                          # Template for credentials (copy to .env)
├── .dockerignore                         # Excludes files from Docker build context
├── app/                                  # Next.js 16 application (App Router)
│   ├── Dockerfile                        # Multi-stage Docker build (deps → build → runner)
│   ├── .dockerignore                     # Excludes node_modules, .next, etc. from build context
│   ├── .gitignore                        # Excludes node_modules, .next, .env*, coverage
│   ├── README.md                         # App-specific development notes and scripts reference
│   ├── package.json                      # Node.js dependencies and scripts
│   ├── tsconfig.json                     # TypeScript compiler config
│   ├── next.config.ts                    # Next.js config (standalone output for Docker)
│   ├── auth.ts                           # Auth.js (NextAuth v5) config — Credentials provider, JWT sessions (#120)
│   ├── proxy.ts                          # Next 16 proxy (renamed middleware) — redirects unauthenticated requests to /login
│   ├── instrumentation.ts                # onRequestError — captures unhandled server throws as structured logs (#129)
│   ├── drizzle.config.ts                 # Drizzle ORM config (schema path + migrations output dir)
│   ├── eslint.config.mjs                 # ESLint flat-config (Next.js + TypeScript rules, no-console over app code)
│   ├── postcss.config.mjs                # PostCSS config (Tailwind CSS v4 plugin)
│   ├── .env.local.example                # Template for app env vars (copy to .env.local)
│   ├── app/                              # App Router — pages and layouts
│   │   ├── api/health/route.ts           # Health check endpoint (Docker liveness + seed-row drift detection against SEED_REFERENCES; public)
│   │   ├── api/auth/[...nextauth]/route.ts # Auth.js sign-in/sign-out/session endpoints
│   │   ├── layout.tsx                    # Root layout (fonts, ThemeProvider, Toaster)
│   │   ├── globals.css                   # Global styles and Tailwind CSS theme variables
│   │   ├── global-error.tsx              # Root-layout error boundary — own <html>/<body>, no app providers (#129)
│   │   ├── favicon.ico
│   │   ├── (landing)/                    # Route group — no sidebar
│   │   │   └── page.tsx                  #   Landing page (/)
│   │   ├── (auth)/                       # Route group — no sidebar
│   │   │   └── login/page.tsx            #   Sign-in page (/login)
│   │   └── (app)/                        # Route group — sidebar navigation shell
│   │       ├── layout.tsx                #   App shell (SidebarProvider + AppSidebar + SidebarInset) + auth() gate → /login
│   │       ├── error.tsx                 #   Error boundary — retry UI; reports with route + digest (#129)
│   │       ├── dashboard/                #   Tabbed dashboard — 5 sections, each with drill-down sub-tabs:
│   │       │   ├── layout.tsx            #     Layout: top-level section tabs + ensureTodayBalances()
│   │       │   ├── dashboard-tabs.tsx    #     Top-level tabs (Summary / Accounting / Transactions / Accounts / Work Expenses)
│   │       │   ├── page.tsx              #     Summary overview (/) — page-level date filter, date-aware KPI snapshot + trends
│   │       │   ├── net-worth/            #     Summary › Net Worth drill-down (allocation, drivers, decomposition, waterfall)
│   │       │   ├── assets/               #     Summary › Assets drill-down (allocation, performance, liquidity, trend)
│   │       │   ├── liabilities/          #     Summary › Liabilities drill-down (allocation, debt-mix, waterfall, debt service, performance)
│   │       │   ├── accounting/           #     Personal Accounting:
│   │       │   │   ├── page.tsx              #       Overview — charts + Income/Expenses/Investments KPI columns
│   │       │   │   ├── income/page.tsx       #       Income drill-down (stub)
│   │       │   │   ├── expenses/page.tsx     #       Expenses drill-down (stub)
│   │       │   │   ├── investments/page.tsx  #       Investments drill-down (stub)
│   │       │   │   ├── cash-flow/page.tsx    #       Cash Flow drill-down (stub)
│   │       │   │   └── budget/page.tsx       #       Budget drill-down (stub)
│   │       │   ├── transactions/         #     Transactions:
│   │       │   │   ├── page.tsx              #       Overview — filter bar + list + new-transaction form
│   │       │   │   ├── categories/page.tsx   #       Categories drill-down (stub)
│   │       │   │   ├── merchants/page.tsx    #       Merchants drill-down (stub)
│   │       │   │   └── recurring/page.tsx    #       Recurring drill-down (stub)
│   │       │   ├── accounts/             #     Accounts:
│   │       │   │   ├── page.tsx              #       Overview — visual balance sheet
│   │       │   │   ├── activity/page.tsx     #       Activity drill-down (stub)
│   │       │   │   └── reconciliation/page.tsx #     Reconciliation drill-down (stub)
│   │       │   └── work-expenses/        #     Work Expenses:
│   │       │       ├── page.tsx              #       Overview — KPIs + charts
│   │       │       └── reimbursements/page.tsx #     Reimbursements drill-down (stub)
│   │       ├── accounts/                 #   /accounts, /accounts/new, /accounts/[id]/edit
│   │       ├── settings/categories/      #   /settings/categories — CRUD for all reference-data tables
│   │       └── test-ui/                  #   /test-ui — UI component verification page
│   ├── components.json                   # shadcn/ui configuration
│   ├── drizzle/                          # Drizzle ORM schema + migrations
│   │   ├── schema.ts                     # Source of truth for schema — edit, then run db:generate
│   │   ├── relations.ts                  # Table relations for type-safe joins
│   │   └── migrations/                   # Authored migrations (versioned, applied by drizzle-kit migrate)
│   │       ├── 0000_baseline.sql         # Baseline matching current prod schema
│   │       ├── 0003_add_users_table.sql  # users table for authentication (#120)
│   │       ├── 0004_add_audit_log.sql    # audit_log + the audit_row_change() trigger, hand-appended (#180)
│   │       └── meta/                     # Drizzle migration journal and snapshots
│   │           ├── _journal.json         # Ordered list of applied migrations (idx, tag, breakpoints)
│   │           └── 0000_snapshot.json    # Full schema snapshot at the 0000_baseline migration
│   ├── scripts/
│   │   ├── migrate-and-seed.sh           # Entrypoint for the `migrate` Compose service (drizzle-kit migrate + seed)
│   │   ├── check-seed-references.ts       # CI gate: SEED_REFERENCES (id, name) must match shared-lookups.sql (#155), which must stay additive (#187)
│   │   ├── create-user.ts                 # First-user CLI / password reset (npm run auth:create-user -- <username>)
│   │   └── seed-reference-check.ts        # Pure parse + diff helpers backing the gate (unit-tested)
│   ├── hooks/
│   │   └── use-mobile.ts                 # Mobile breakpoint detection hook (used by sidebar)
│   ├── components/
│   │   ├── app-sidebar.tsx               # Global sidebar navigation (Dashboard, Accounts, Settings) + sign-out
│   │   ├── auth/login-form.tsx           # Sign-in form (useActionState → authenticate action)
│   │   ├── ui/                           # shadcn/ui primitives + custom wrappers
│   │   │   ├── combobox.tsx              # Searchable select dropdown (custom)
│   │   │   ├── currency-input.tsx        # Numeric currency entry with symbol prefix (custom)
│   │   │   ├── date-picker.tsx           # Single-date calendar popover (custom)
│   │   │   ├── date-range-picker.tsx     # Date range with quick-select presets + manual input (custom)
│   │   │   ├── date-range-macros.ts      # Saved Quick Select macros: types, built-in defaults, localStorage helpers
│   │   │   └── input-group.tsx           # Input with inline prefix/suffix slot (custom)
│   │   ├── charts/                       # Chart components (client components)
│   │   │   ├── accounting-chart.tsx      # Time-series area chart for income/expenses/investments (Chart.js)
│   │   │   ├── expenses-category-chart.tsx # Donut chart for expense category breakdown (Chart.js)
│   │   │   ├── work-expenses-chart.tsx   # Grouped bar chart for work expenses vs reimbursements over time
│   │   │   ├── net-worth-chart.tsx       # Reusable time-series line chart (Recharts)
│   │   │   ├── waterfall-chart.tsx       # Net worth waterfall analysis chart (Recharts)
│   │   │   ├── net-worth-timeseries-chart.tsx # Multi-series decomposition chart for net-worth drill-down (Recharts)
│   │   │   ├── asset-allocation-chart.tsx # Treemap of assets by category → account type (Recharts)
│   │   │   ├── assets-timeseries-chart.tsx # Stacked area chart of asset balances by category (Recharts)
│   │   │   ├── liability-allocation-chart.tsx # Treemap of liabilities by category → account type (Recharts)
│   │   │   ├── liabilities-timeseries-chart.tsx # Stacked area chart of liability balances by category (Recharts)
│   │   │   ├── debt-waterfall-chart.tsx  # Debt waterfall (Start → Payments → Interest → Other → End) (Recharts)
│   │   │   └── gauge-badge.tsx           # Custom SVG semicircular gauge with range segments
│   │   ├── accounts/                     # Accounts page components
│   │   │   ├── accounts-table.tsx        # Two-column balance sheet with expand/collapse; exports amountColorClass()
│   │   │   ├── accounts-by-category.tsx  # Grouped card view: Assets (2x2) + Liabilities, with per-type + icon
│   │   │   ├── account-form.tsx          # Create/edit account form with combobox type selector
│   │   │   └── delete-account-dialog.tsx # Delete confirmation dialog with transaction check
│   │   ├── settings/                     # Settings page components
│   │   │   ├── entity-card.tsx           # Reusable card for flat entities (name-only CRUD)
│   │   │   ├── account-types-card.tsx    # Account Types card with types nested under category
│   │   │   ├── entity-dialog.tsx         # Add/edit modal dialog (name + optional category combobox)
│   │   │   └── delete-entity-dialog.tsx  # Delete confirmation dialog with in-use guard
│   │   ├── dashboard/                    # Dashboard-specific components
│   │   │   ├── page-header.tsx           # Standard page header — optional sub-nav + h1 title + filter bar below (shared by all dashboard pages)
│   │   │   ├── drilldown-tabs.tsx        # Config-driven drill-down sub-tabs for every section (DRILLDOWN_SECTIONS source of truth)
│   │   │   ├── coming-soon.tsx           # Placeholder body for scaffolded drill-down pages not yet built out
│   │   │   ├── accounting-filters.tsx    # Label-less multi-select combobox filter bar for accounting page
│   │   │   ├── accounting-kpi-card.tsx   # KPI card with change indicator for accounting metrics
│   │   │   ├── date-range-filter.tsx     # URL-param-driven date range filter wrapper
│   │   │   ├── date-range-error.tsx       # Inline "Invalid date range" error state (rendered when validateDateRange rejects params)
│   │   │   ├── net-worth-drivers-table.tsx # Expandable net worth drivers table (category → account type → account)
│   │   │   ├── asset-performance-table.tsx # Expandable assets performance table (category → account type → account)
│   │   │   ├── liquidity-breakdown.tsx   # Liquidity classification tiles + stacked bar
│   │   │   ├── liability-performance-table.tsx # Expandable liability performance table (category → account type → account)
│   │   │   ├── debt-mix-breakdown.tsx    # Debt mix tiles per account type (current vs. long-term)
│   │   │   └── debt-service-summary.tsx  # Period payments, interest accrued, estimated principal paid + per-account sub-table
│   │   └── transactions/                 # Transaction-specific components
│   │       ├── transaction-form.tsx      # Transaction entry form (client component)
│   │       ├── transaction-list.tsx      # Sortable transaction table with inline edit + delete (client component)
│   │       ├── transaction-edit-row.tsx  # Inline row-edit form (client component, uses updateTransaction action)
│   │       ├── transaction-delete-dialog.tsx # Delete confirmation modal (uses deleteTransaction action)
│   │       ├── transaction-filters.tsx   # Label-less filter bar with date range, multi-select, amount
│   │       └── transaction-columns.ts    # Shared ColumnKey type + visible-columns cookie helpers (server- and client-safe)
│   ├── lib/                              # Shared libraries
│   │   ├── constants/reference-ids.ts    # Centralized seed-row references (id + canonical name) and SEED_REFERENCES driver for the /api/health drift check
│   │   ├── db/index.ts                   # Drizzle ORM client (PostgreSQL connection)
│   │   ├── db/audited.ts                 # auditedTransaction() — names the actor for the audit trigger (#180)
│   │   ├── log.ts                        # Structured single-line JSON logger — isomorphic, LOG_LEVEL-gated (#129)
│   │   ├── report.ts                     # reportError() — the one error choke point; redacts drizzle params + pg detail (#129)
│   │   ├── auth/password.ts              # scrypt hashPassword/verifyPassword (node:crypto, no native deps)
│   │   ├── auth/verify-credentials.ts    # Username/password check against the users table
│   │   ├── auth/guard.ts                 # requireActionUser() — session gate at the top of every server action
│   │   ├── actions/utils.ts              # Shared ActionState type and buildFieldErrors() helper
│   │   ├── actions/failure.ts            # actionFailure() — reports a caught action error with its actor, returns the ActionState (#129)
│   │   ├── actions/auth.ts               # Server actions for sign-in (authenticate) and sign-out
│   │   ├── actions/transaction.ts        # Server action for transaction submission
│   │   ├── actions/account.ts            # Server actions for account create, update, delete
│   │   ├── actions/categories.ts         # Server actions for category/type create, update, delete
│   │   ├── queries/_aggregates.ts        # Shared SQL fragments (sum-by-type, balance-at-date, bound IN-list)
│   │   ├── queries/accounts.ts           # Account balance queries (ROLLUP aggregation)
│   │   ├── queries/accounting.ts         # Accounting queries (time series, period totals, category breakdown, averages)
│   │   ├── queries/work-expenses.ts      # Work expense queries (period totals, time series, category breakdown)
│   │   ├── queries/dashboard.ts          # Dashboard queries (net worth, time series)
│   │   ├── queries/net-worth-drilldown.ts # Net worth drill-down queries (waterfall, drivers, decomposition)
│   │   ├── queries/assets-drilldown.ts   # Assets drill-down queries (allocation, performance, liquidity, decomposition)
│   │   ├── queries/liabilities-drilldown.ts # Liabilities drill-down queries (allocation, performance, decomposition, debt service, waterfall)
│   │   ├── queries/liability-categories.ts # Pinned transaction_category_ids for debt payments and interest expense
│   │   ├── queries/rebuild-balance.ts    # Per-account balance history rebuild
│   │   ├── queries/transactions.ts       # Transaction queries (filtered, sorted, form options)
│   │   ├── queries/date-range.ts         # Shared dateFrom/dateTo URL-param parsing + 30-day default
│   │   ├── queries/categories.ts         # Queries for all four reference-data tables
│   │   ├── format/financial.ts           # Shared signed-currency, change-color, percent helpers (used by asset + liability tables)
│   │   ├── forms/transaction.ts          # Post-submit state helper (persists Date, Account, Type across submits)
│   │   ├── validations/account.ts        # Zod schema for account form validation
│   │   ├── validations/transaction.ts    # Zod schema for transaction form validation
│   │   ├── validations/categories.ts     # Zod schemas for category/type forms
│   │   ├── validations/date-range.ts     # Canonical dateFrom/dateTo validator (format + ordering) + isValidIsoDate
│   │   ├── validations/id.ts             # parseEntityId()/isEntityId() — the one positive-int4 check for every ID (#179)
│   │   ├── validations/search-params.ts  # validateFilterParams() — ID lists, amount, descriptions from the URL (#179)
│   │   └── utils.ts                      # Utility helpers (cn() class merge)
│   ├── tests/                            # Vitest test suite
│   │   ├── unit/                         # Unit tests (no DB required)
│   │   │   ├── validations/              #   Zod schema tests (account, transaction, categories, date-range, id, search-params)
│   │   │   ├── actions/                  #   Action utility tests (buildFieldErrors)
│   │   │   ├── components/               #   Component function tests (waterfall transform, liquidity, asset perf, debt-mix, debt-waterfall, liability perf, date-range macros)
│   │   │   ├── scripts/                  #   Build-tooling tests (seed-reference gate parse + diff)
│   │   │   └── lib/                      #   Library utility tests
│   │   │       ├── utils.test.ts         #     cn() class-merge helper
│   │   │       ├── forms/                #     Form helpers (transaction post-submit state)
│   │   │       ├── format/               #     Formatters (signed-currency, change-color, percent helpers)
│   │   │       ├── db/                   #     auditedTransaction() actor plumbing
│   │   │       ├── log.test.ts           #     Structured logger (single-line output, LOG_LEVEL gate, hostile payloads)
│   │   │       ├── report.test.ts        #     reportError() serialization + drizzle/pg redaction
│   │   │       └── queries/              #     Query helpers (liability-categories pinned IDs, date-range param parsing)
│   │   └── integration/                  # Integration tests (requires Finances_Test DB)
│   │       ├── setup.ts                  #   Global setup — asserts test DB URL
│   │       ├── vitest-setup.ts           #   Per-test setup/teardown (mocks @/auth with a signed-in session)
│   │       ├── actions/                  #   Server action tests (account, transaction, auth gating, audit trail, failure logging, validation contract)
│   │       ├── auth/                     #   Credential verification against the real users table
│   │       ├── api/                      #   API route tests (health drift check)
│   │       └── queries/                  #   Query function tests (accounting, grouping matrix, rebuild-balance, drilldowns)
│   └── vitest.config.ts                  # Vitest configuration (unit + integration projects)
├── importer/                              # File import service
│   ├── poll.py                            # Polling loop and parser dispatcher (committed)
│   └── parsers/                           # One module per import type (gitignored)
├── imports/                               # Drop folders — one per import type (gitignored)
├── backups/                               # pg_dump output from the pg-backup service (contents gitignored)
├── .github/workflows/ci.yml             # CI: schema-drift + seed-reference gates, lint, unit + integration tests
├── .github/workflows/backup-smoke.yml   # CI: weekly backup + restore round-trip smoke test (#122)
├── .vscode/extensions.json              # Recommended VS Code extensions for this project
├── init-db/
│   ├── 01-create-databases.sh            # First-run DB + Metabase role creation only (auto-runs on empty data dir)
│   ├── roles/                            # Least-privilege service roles (#130), applied by the `migrate` service
│   │   ├── 01-create-roles.sql           # finance_app / finance_importer / finance_metabase (cluster-global)
│   │   ├── 02-grants.sql                 # Per-database grant matrix; revokes then grants, so it converges
│   │   └── assert-grants.sql             # Catalog assertions for the matrix — the CI grant gate
│   └── seeds/                            # Applied by the `migrate` Compose service after migrations
│       ├── shared-lookups.sql            # account_type_categories + transaction_types (both DBs, every run — must stay additive, #187)
│       ├── finances-test-mock-data.sql   # account_types, transaction_categories, accounts, ~400 txns (Finances_Test only)
│       └── rebuild-balance-history.sql   # Balance history rebuild for Finances_Test post-seed
└── scripts/
    ├── update-account-balance-history.sql   # Balance history rebuild script (manual / --profile init)
    ├── backup.sh                            # Scheduled pg_dump with retention pruning (pg-backup service)
    ├── restore.sh                           # Restore a dump into a clean database (#122)
    └── verify-db-roles.sh                   # Grant matrix + behavioural privilege check per role (#130)
```
