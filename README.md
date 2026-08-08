# Finance Stack

A containerized personal finance data warehouse for aggregating, storing, and visualizing multi-account financial data.

## Stack

| Service | Description | Local Port |
|---|---|---|
| PostgreSQL 18 | Primary database | 5433 (loopback only) |
| Next.js 16 | Custom finance application | 3001 |
| importer | File ingestion (polls `imports/` subfolders) | — |
| Metabase | BI dashboards and analytics (`--profile bi`) | 3000 (loopback only) |
| Caddy | TLS termination for exposed deployments (`--profile edge`) | 80, 443 |

## Security

The app requires **session-based sign-in** (Auth.js with a username/password stored in the `users` table). All application pages and every server action reject unauthenticated requests; only the landing page, the sign-in page, and `/api/health` are public. There is no self-registration — create the first user (or reset a password) with the CLI:

```bash
cd app
npm run auth:create-user -- <username>
```

Sign in at http://localhost:3001/login and sign out from the sidebar footer. See [docs/auth.md](docs/auth.md) for the full model, the `AUTH_SECRET` requirement, and password resets.

At the data tier, Postgres and Metabase publish their host ports on **loopback only**, and each service connects as its own **least-privilege role** rather than the `postgres` superuser: the app has no DDL and is read-only on `users`, the importer can only append transactions, and Metabase reads through a role that cannot touch `users` or `audit_log` and cannot write. Exactly one login role in the cluster is a superuser — the maintenance identity the one-shot jobs run as — and CI asserts that for *every* role, not a list of the expected ones. See [docs/database.md](docs/database.md#roles--privileges) for the grant matrix and how to verify it.

At the edge, every response carries a **content security policy** and the usual hardening headers (HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`), sign-ins are **rate limited** to five failures per username per 15 minutes, and server actions to 120 per user per minute.

**The default posture is still a trusted network** — localhost, a LAN, a VPN, Tailscale or similar — because the app speaks plain HTTP and nothing else encrypts it. Exposing it to the internet means putting TLS in front: a `caddy` service ships for exactly this, switched off, and starts with `docker compose --profile edge up -d` once `PUBLIC_HOSTNAME` is set. See [docs/deployment.md](docs/deployment.md) for the two postures, the full checklist for going public, and what each control does and does not cover.

Credentials are sourced from a single `.env` file on the deployment host — never committed, never baked into an image, and enforced by ignore-rule tests plus a full-history secret scan in CI. See [docs/secrets.md](docs/secrets.md) for the inventory, the production sourcing model, and rotation.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 22+](https://nodejs.org/) (for the Next.js application)

## Getting Started

### 1. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and replace **every** `changeme` placeholder with your own value — including the three `FINANCE_*_DB_PASSWORD` service-role passwords, which are required (the migrate service aborts rather than create a login role with a blank password). Keep them URL-safe, since they go into connection strings. Generate a real `AUTH_SECRET` (signs the session cookies):

```bash
openssl rand -base64 33
```

> **Upgrading an existing stack?** `FINANCE_APP_DB_PASSWORD`, `FINANCE_IMPORTER_DB_PASSWORD` and `FINANCE_BI_DB_PASSWORD` are new. Copy them from `.env.example` into your `.env`, then `docker compose up` — the migrate service creates the roles and applies their grants to your existing databases. No manual SQL, no data migration. If you use Metabase, re-point its Finances connection at a least-privilege role — and check what it is set to first, since that step is manual and easy to have never done ([docs/database.md](docs/database.md#pointing-metabase-at-a-least-privilege-role)).

### 2. Start the stack

```bash
docker compose up
```

This will:
1. Start PostgreSQL and wait until it is healthy
2. Run the `migrate` service: applies pending Drizzle migrations to `Finances` and `Finances_Test`, then seeds lookup data
3. Build and start the Next.js finance application
4. Start the importer service

The `importer` service polls subdirectories under `imports/` every 60 seconds and routes files to matching parsers. See [docs/importer.md](docs/importer.md) for setup and adding new import types.

### Start Metabase (optional)

Metabase is behind a Docker Compose profile and does not start by default. To start it:

```bash
docker compose --profile bi up metabase -d
```

To start the full stack including Metabase:

```bash
docker compose --profile bi up
```

### 3. Set up the Next.js application (local development only)

> **Note:** Steps 3 and 4 are for local development only. When running
> `docker compose up`, the Next.js app is built and started automatically
> inside a container.

```bash
cd app
cp .env.local.example .env.local
npm install
```

Edit `app/.env.local`, set `DATABASE_URL` to match your PostgreSQL credentials from `.env`, and set a real `AUTH_SECRET` (`openssl rand -base64 33`).

Create a user to sign in with (the dev `.env.local` points at `Finances_Test`; run with `DATABASE_URL` overridden to target another database):

```bash
npm run auth:create-user -- <username>
```

### 4. Start the Next.js dev server (local development only)

```bash
cd app
npm run dev
```

The app starts on http://localhost:3001 with Turbopack for fast refresh.

### 5. Access the services

- **Finance App:** http://localhost:3001
- **Metabase:** http://localhost:3000 (requires `--profile bi`; loopback only)
- **PostgreSQL:** `localhost:5433` (database: `Finances`) — loopback only, so use `localhost`, not the host's LAN address. Connect as `postgres` for admin work; the services use their own restricted roles ([grant matrix](docs/database.md#roles--privileges)).

## Stopping the Stack

```bash
docker compose down
```

Data is persisted in Docker volumes and will be available on next startup.

## Backups

The `pg-backup` service runs a scheduled `pg_dump` of the `Finances` and
`metabase` databases into `./backups/` (default daily, 14-day retention). It
starts automatically with `docker compose up`. Restore the newest dump into a
throwaway database with:

```bash
docker compose exec pg-backup /scripts/restore.sh --force Finances Finances_Restore_Check
```

See [docs/backups.md](docs/backups.md) for configuration, full disaster
recovery, and the weekly restore-smoke CI check.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev workflow, commit conventions, CI gates, changelog habits, and the release process.

## Documentation

- [Contributing](CONTRIBUTING.md) — dev workflow, conventions, and the release process
- [Authentication](docs/auth.md) — the auth model, first-user CLI, `AUTH_SECRET`, and password resets
- [Database](docs/database.md) — schema, views, balance history, first-launch init, and the test database
- [Deployment & Exposure](docs/deployment.md) — trusted-network vs public-internet posture, TLS termination, security headers, and rate limits
- [Backups](docs/backups.md) — the scheduled backup service, retention, and disaster recovery
- [Observability](docs/observability.md) — structured JSON logs, where errors are captured, redaction, and wiring an error-tracking backend
- [Schema Changes](docs/schema-changes.md) — making schema changes and adopting migrations on existing databases
- [Testing](docs/testing.md) — running tests and the static lookup-table fixtures
- [Importer](docs/importer.md) — the importer service and adding new import types
- [Project Structure](docs/project-structure.md) — repository layout and directory tree
- [Releases & Tagging](docs/releases.md) — versioning, the `vX.Y.Z` tag convention, and how releases map to `CHANGELOG.md`
- [Versioning Roadmap](docs/roadmap.md) — how phase milestones map to release versions on the path to `v1.0.0`
- [Changelog](CHANGELOG.md) — release history and version notes
