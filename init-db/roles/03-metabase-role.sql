-- ==============================================
-- Metabase metadata-role convergence (Issue #239).
--
-- Re-asserts what MB_DB_USER — the role Metabase authenticates as against its
-- OWN metadata database — is allowed to be. It is not one of the three service
-- roles from #130; it is created by init-db/01-create-databases.sh, which runs
-- only on an empty PGDATA. That is how the live cluster ended up with a
-- SUPERUSER metabase_user carrying CREATEDB, CREATEROLE, REPLICATION and
-- BYPASSRLS, widened out-of-band, with nothing in the repository to re-assert
-- it and nothing in the grant gate to notice.
--
-- Run against the METADATA database (MB_DB_DBNAME), not the maintenance
-- database — step 3 is a schema-level GRANT, which has to be issued from
-- inside the database that owns the schema:
--   psql -d metabase -v mb_user=metabase_user -f init-db/roles/03-metabase-role.sql
--
-- Applied by the `migrate` Compose service (app/scripts/migrate-and-seed.sh),
-- for the same reason 01-create-roles.sql is: migrate runs idempotently on
-- every `docker compose up`, so it reaches existing volumes. init-db/ cannot.
--
-- Required psql variables:
--   mb_user  the Metabase metadata role name (MB_DB_USER), passed with -v
--   DBNAME   set automatically by psql from the -d connection
--
-- Interpolated through format(%I) rather than shell-expanded into the SQL text,
-- so a role name needing quoting is quoted. Note psql does NOT expand
-- :variables inside dollar-quoted strings, which is why this uses \gexec rather
-- than DO $$ ... $$ — the same constraint 01-create-roles.sql works around.
--
-- ── Statement order is the safety property ────────────────────────────────
-- Metabase runs its own schema migrations against this database at startup, so
-- it needs ownership of it (or CREATE on it) — but NOT superuser. De-privilege
-- before confirming that, and the next Metabase start fails on its own
-- migration. So: establish ownership and rights FIRST, strip attributes LAST.
-- Nothing here is wrapped in a transaction, and that is deliberate given the
-- ordering: every statement is independently idempotent, and a failure part-way
-- leaves the role MORE privileged than intended, never less. Re-running
-- converges. The reverse order would have the opposite failure direction.
--
-- Deliberately does NOT touch PASSWORD. MB_DB_PASS still cannot be rotated from
-- .env — that is issue #189, and syncing it here would half-solve it in the one
-- place someone would later assume was authoritative.
-- ==============================================

\set ON_ERROR_STOP on

-- ── 1. Ownership of the metadata database ─────────────────────────────────
-- The declared design since the first commit that created it
-- (`CREATE DATABASE ... OWNER ${MB_DB_USER}`), converged here so a database
-- that drifted to another owner is corrected rather than silently left where a
-- non-superuser Metabase could no longer migrate it. The join yields no row —
-- and so runs nothing — when the role is absent or already the owner.
SELECT format('ALTER DATABASE %I OWNER TO %I', d.datname, r.rolname)
FROM pg_database d
JOIN pg_roles r ON r.rolname = :'mb_user'
WHERE d.datname = current_database()
  AND d.datdba <> r.oid\gexec

-- ── 2. PUBLIC holds nothing on this database ──────────────────────────────
-- The metadata database was created with no explicit ACL, which means the
-- Postgres default: PUBLIC gets CONNECT and TEMPORARY. Every role in the
-- cluster could therefore open a session on it — finance_app's credential
-- included — and this database holds Metabase's own users table. Nothing on
-- the Finances side has been reachable that way since #130 revoked the same
-- default there (02-grants.sql), so this closes the matching gap on the
-- metadata side. The database owner keeps its access: ownership is not an ACL
-- entry, and step 3 grants it explicitly besides.
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ── 3. The rights Metabase's startup migrations actually need ─────────────
-- On PG15+ the database owner already holds both of these implicitly: `public`
-- is owned by pg_database_owner, which resolves to whoever owns the database.
-- They are granted explicitly anyway, because that implication is a property of
-- the server version and of who owns `public` — neither of which this file
-- controls. A metadata database restored from an older cluster, or one whose
-- `public` schema is owned by postgres, needs the grant to be real.
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I',
              current_database(), rolname)
FROM pg_roles WHERE rolname = :'mb_user'\gexec

SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', rolname)
FROM pg_roles WHERE rolname = :'mb_user'\gexec

-- ── 4. Strip the cluster-wide attributes ──────────────────────────────────
-- Unconditional (not guarded on the current values) so it converges: an
-- attribute re-widened by hand is removed on the next `up`, exactly as
-- 02-grants.sql revokes before it grants. LOGIN is re-stated because this role
-- exists to log in; everything else is denied. A login role the stack does NOT
-- declare is deliberately left alone here and fails assert-grants.sql instead —
-- the stack converges what it declares and refuses to be silent about the rest.
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
              ' NOREPLICATION NOBYPASSRLS', rolname)
FROM pg_roles WHERE rolname = :'mb_user'\gexec

-- Says which of the two things happened, since every statement above is silent
-- when the role is absent (a cluster that has never provisioned Metabase).
SELECT CASE
    WHEN EXISTS (SELECT FROM pg_roles WHERE rolname = :'mb_user')
    THEN format('%s converged: owns %s, USAGE+CREATE on public, no cluster attributes',
                :'mb_user', current_database())
    ELSE format('role %s does not exist — nothing to converge', :'mb_user')
END AS "metabase metadata role";
