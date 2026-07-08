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

This application has **no authentication**. Anyone who can reach the HTTP port (3001) can read, create, edit, and delete all financial data. Only expose it on a trusted network — localhost, a VPN, Tailscale, or similar — never on the public internet. A full security and integrity model (auth, authorization, audit logging, deployment hardening, backup policy) is tracked in [#100](https://github.com/aellington89/finance-stack/issues/100).

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 22+](https://nodejs.org/) (for the Next.js application)

## Getting Started

### 1. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and replace the `changeme` placeholder passwords with your own values.

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

Edit `app/.env.local` and set `DATABASE_URL` to match your PostgreSQL credentials from `.env`.

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
- [Database](docs/database.md) — schema, views, balance history, first-launch init, and the test database
- [Schema Changes](docs/schema-changes.md) — making schema changes and adopting migrations on existing databases
- [Testing](docs/testing.md) — running tests and the static lookup-table fixtures
- [Importer](docs/importer.md) — the importer service and adding new import types
- [Project Structure](docs/project-structure.md) — repository layout and directory tree
- [Releases & Tagging](docs/releases.md) — versioning, the `vX.Y.Z` tag convention, and how releases map to `CHANGELOG.md`
- [Versioning Roadmap](docs/roadmap.md) — how phase milestones map to release versions on the path to `v1.0.0`
- [Changelog](CHANGELOG.md) — release history and version notes
