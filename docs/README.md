# Documentation

## Strategy

Finance Stack documentation is split by purpose. The root [README](../README.md) is the **entry point** — overview, stack, security, quick start, and links out. The guides in this `docs/` folder hold **focused operational and reference content** (database, schema changes, testing, the importer, and project structure). [`CHANGELOG.md`](../CHANGELOG.md) (release history, with tagging and release conventions in [Releases & Tagging](releases.md)) and [`CONTRIBUTING.md`](../CONTRIBUTING.md) (dev workflow, conventions, and the release process) round out the set.

## Guides

- [Database](database.md) — schema, views, balance history, first-launch init, and the test database
- [Schema Changes](schema-changes.md) — making schema changes and adopting migrations on existing databases
- [Testing](testing.md) — running tests and the static lookup-table fixtures
- [Importer](importer.md) — the importer service and adding new import types
- [Project Structure](project-structure.md) — repository layout and directory tree
- [Releases & Tagging](releases.md) — versioning, the `vX.Y.Z` tag convention, and how releases map to `CHANGELOG.md`
