# 0001. Authored Drizzle migrations are the schema's source of truth

Date: 2026-05-23 · Status: Accepted · Issue: #121

## Context

Before [Issue #121](https://github.com/aellington89/finance-stack/issues/121), the schema had two
sources of truth: `init-db/schema.sql`, kept by hand from `pg_dump`, and `app/drizzle/schema.ts`,
reverse-engineered from the live database by `drizzle-kit pull`. A change made through one drifted
from the other, and fresh installs and existing databases diverged. Recorded on 2026-11-23 from
[schema-changes.md](../schema-changes.md) and the issue.

## Decision

`app/drizzle/schema.ts` is the schema's single source of truth. Every change is an edit there,
followed by `npm run db:generate -- --name <description>`, which writes a versioned
`app/drizzle/migrations/NNNN_<description>.sql`. The history starts from `0000_baseline.sql`,
pulled from the live database once. The one-shot `migrate` service applies pending migrations on
every `docker compose up`, before the app and importer start. `npm run db:pull` is for inspection
only.

## Consequences

- One path changes the schema, and CI's drift gate fails a `schema.ts` edit that has no migration.
  The gate runs `drizzle-kit generate`, not `pull`, because `pull`'s catalog introspection isn't
  deterministic (composite-index op classes, primary key column order).
- An applied migration's SQL file is immutable, since Drizzle records its hash. A correction is a
  new migration (Issue #157).
- Drizzle writes no down migrations. Rolling back across a schema change means restoring a dump,
  which is why each release declares a `**Migration:**` marker ([0004](0004-releases-ship-ghcr-images-and-a-deploy-bundle.md)).
- Whatever Drizzle doesn't model, such as audit triggers and `COMMENT ON`, is appended to the
  generated SQL by hand, and `app/drizzle/relations.ts` is updated by hand when a foreign key
  changes.
- A database from before migrations existed must have its baseline marked as applied once
  ([Adopting migrations](../schema-changes.md#adopting-migrations-on-an-existing-database)).

## Alternatives considered

- **Keep `schema.sql` from `pg_dump` and `schema.ts` from `drizzle-kit pull`, both from the live
  database.** That was the state that caused the drift.
- **Apply migrations when the app boots.** #121 offered this or a dedicated Compose service, and
  the service was built. It gates the app and the importer with `service_completed_successfully`,
  and it later let the app's own role go without DDL rights
  ([0002](0002-each-service-connects-as-its-own-least-privilege-role.md)).
