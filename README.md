# Finance Stack

A containerized personal finance data warehouse for aggregating, storing, and visualizing multi-account financial data.

## Stack

| Service | Description | Local Port |
|---|---|---|
| PostgreSQL 18 | Primary database | 5433 |
| Next.js 16 | Custom finance application | 3001 |
| importer | File ingestion (polls `imports/` subfolders) | — |
| Metabase | BI dashboards and analytics (`--profile bi`) | 3000 |

## Security

The app requires **session-based sign-in** (Auth.js with a username/password stored in the `users` table). All application pages and every server action reject unauthenticated requests; only the landing page, the sign-in page, and `/api/health` are public. There is no self-registration — create the first user (or reset a password) with the CLI:

```bash
cd app
npm run auth:create-user -- <username>
```

Sign in at http://localhost:3001/login and sign out from the sidebar footer. See [docs/auth.md](docs/auth.md) for the full model, the `AUTH_SECRET` requirement, and password resets.

Authentication alone does not make the app safe for the public internet: transport encryption, rate limiting, and deployment hardening are still tracked in [#100](https://github.com/aellington89/finance-stack/issues/100) (see [#130](https://github.com/aellington89/finance-stack/issues/130), [#181](https://github.com/aellington89/finance-stack/issues/181), [#182](https://github.com/aellington89/finance-stack/issues/182)). Keep it on a trusted network — localhost, a VPN, Tailscale, or similar — until those land.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 22+](https://nodejs.org/) (for the Next.js application)

## Getting Started

### 1. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and replace the `changeme` placeholder passwords with your own values. Generate a real `AUTH_SECRET` (signs the session cookies):

```bash
openssl rand -base64 33
```

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
- **Metabase:** http://localhost:3000 (requires `--profile bi`)
- **PostgreSQL:** `localhost:5433` (user: `postgres`, database: `Finances`)

## Stopping the Stack

```bash
docker compose down
```

Data is persisted in Docker volumes and will be available on next startup.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev workflow, commit conventions, CI gates, changelog habits, and the release process.

## Documentation

- [Contributing](CONTRIBUTING.md) — dev workflow, conventions, and the release process
- [Authentication](docs/auth.md) — the auth model, first-user CLI, `AUTH_SECRET`, and password resets
- [Database](docs/database.md) — schema, views, balance history, first-launch init, and the test database
- [Schema Changes](docs/schema-changes.md) — making schema changes and adopting migrations on existing databases
- [Testing](docs/testing.md) — running tests and the static lookup-table fixtures
- [Importer](docs/importer.md) — the importer service and adding new import types
- [Project Structure](docs/project-structure.md) — repository layout and directory tree
- [Releases & Tagging](docs/releases.md) — versioning, the `vX.Y.Z` tag convention, and how releases map to `CHANGELOG.md`
- [Versioning Roadmap](docs/roadmap.md) — how phase milestones map to release versions on the path to `v1.0.0`
- [Changelog](CHANGELOG.md) — release history and version notes
