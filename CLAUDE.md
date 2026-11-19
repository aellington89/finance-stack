# Finance Stack

A containerized personal finance data warehouse for aggregating, storing, and visualizing
multi-account financial data: PostgreSQL 18, a Next.js 16 app, a Python importer, and optional
Metabase, GlitchTip, and Caddy services, run with Docker Compose. Solo-developer project, built
with the shared dev process (Dev process, below).

## Commands

- `docker compose up`: the whole stack (README, "Getting Started"). `COMPOSE_PROFILES` in
  `.env` adds the optional services.
- In `app/`: `npm run dev`, `npm run lint`, `npm run typecheck`, `npm test` (Vitest), and
  `npm run test:e2e` (Playwright); the gates `npm run check:changelog`, `npm run check:docs`,
  `npm run check:seed-references`, and `npm run check:audit`; and
  `npm run db:generate -- --name <description>` for a migration (docs/schema-changes.md).
- In `importer/`: `pytest tests -v`.

## Where things are

- `app/`: the Next.js app, with Auth.js and Drizzle (`app/drizzle/` holds the migrations).
  `importer/`: file ingestion. `init-db/`: database initialization. `deploy/`: the release
  bundle. `caddy/` and `scripts/`: the edge proxy and the operations scripts.
- docs/README.md indexes the guides. CONTRIBUTING.md has the workflow and every CI gate.

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
| Run the app       | `docker compose up`, or `npm run dev` in `app/` against it (README)                                                                                                                                                                                                                     |
| Format            | n/a: ESLint (`npm run lint` in `app/`) is the style gate; there's no formatter                                                                                                                                                                                                          |
| Next version      | `npm run release:notes -- <previous tag>..HEAD --changelog` in `app/` (docs/releases.md)                                                                                                                                                                                                |
| Prepare a release | docs/releases.md: close the CHANGELOG section with its `**Migration:**` marker, and set `version` in `app/package.json` to match; `npm run check:changelog` holds the two together                                                                                                      |
| User guide        | README.md, and the guides that docs/README.md indexes                                                                                                                                                                                                                                   |
| Roadmap           | GitHub Projects (https://github.com/aellington89/finance-stack/projects); there's no roadmap file                                                                                                                                                                                       |
