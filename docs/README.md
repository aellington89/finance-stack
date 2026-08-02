# Documentation

## Strategy

Finance Stack documentation is split by purpose. The root [README](../README.md) is the **entry point** — overview, stack, security, quick start, and links out. The guides in this `docs/` folder hold **focused operational and reference content** (database, schema changes, testing, the importer, and project structure). [`CHANGELOG.md`](../CHANGELOG.md) (release history, with tagging and release conventions in [Releases & Tagging](releases.md)) and [`CONTRIBUTING.md`](../CONTRIBUTING.md) (dev workflow, conventions, and the release process) round out the set.

## Guides

- [Authentication](auth.md) — the auth model, first-user CLI, `AUTH_SECRET`, and password resets
- [Database](database.md) — schema, views, balance history, first-launch init, and the test database
- [Deployment & Exposure](deployment.md) — trusted-network vs public-internet posture, TLS termination, security headers, and rate limits
- [Secrets](secrets.md) — every credential, how production sources them, rotation, and what keeps them out of the repo and the images
- [Audit Log](audit-log.md) — how mutations are recorded, who gets attributed, reading the log, and retention
- [Input Validation & Error Messages](input-validation.md) — the per-action validation checklist, the SQL parameterization rule, and what a user is allowed to see
- [Observability](observability.md) — structured JSON logs, where errors are captured, redaction, and wiring an error-tracking backend
- [Schema Changes](schema-changes.md) — making schema changes and adopting migrations on existing databases
- [Backups](backups.md) — the scheduled backup service, retention, and disaster recovery
- [Testing](testing.md) — running tests and the static lookup-table fixtures
- [Importer](importer.md) — the importer service and adding new import types
- [Project Structure](project-structure.md) — repository layout and directory tree
- [Releases & Tagging](releases.md) — versioning, the `vX.Y.Z` tag convention, and how releases map to `CHANGELOG.md`
- [Versioning Roadmap](roadmap.md) — how phase milestones map to release versions on the path to `v1.0.0`
