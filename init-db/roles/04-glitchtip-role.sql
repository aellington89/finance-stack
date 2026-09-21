-- ==============================================
-- GlitchTip role convergence (Issue #232).
--
-- Re-asserts what GLITCHTIP_DB_USER — the role GlitchTip authenticates as
-- against its OWN database — is allowed to be, and what it authenticates with.
--
-- This is deliberately a near-copy of 03-metabase-role.sql, because the two
-- roles are the same shape: a self-contained third-party web application that
-- runs its own schema migrations at startup against a database it owns, and
-- that must reach nothing else in the cluster. Where the files differ, the
-- difference is a bug in one of them. The duplication is the honest form here —
-- the alternative is a parameterized file that hides which role it is
-- converging, and #239 is the standing lesson about a role whose real
-- privileges nobody could read off the repository.
--
-- Run against GLITCHTIP'S OWN database (GLITCHTIP_DB_DBNAME), not the
-- maintenance database — step 3 is a schema-level GRANT, which has to be issued
-- from inside the database that owns the schema:
--   psql -d glitchtip -v gt_user=glitchtip -v gt_password="$GLITCHTIP_DB_PASSWORD" \
--        -f init-db/roles/04-glitchtip-role.sql
--
-- Applied by the `migrate` Compose service (app/scripts/migrate-and-seed.sh),
-- for the same reason 01-create-roles.sql and 03-metabase-role.sql are: migrate
-- runs idempotently on every `docker compose up`, so it reaches existing volumes.
-- An initdb hook cannot, which is why nothing in this stack is one any more (#225).
--
-- Required psql variables:
--   gt_user      the GlitchTip role name (GLITCHTIP_DB_USER), passed with -v
--   gt_password  its password (GLITCHTIP_DB_PASSWORD), passed with -v
--   DBNAME       set automatically by psql from the -d connection
--
-- Interpolated through format(%I)/format(%L) rather than shell-expanded into the
-- SQL text, so a role name needing quoting is quoted and a password containing a
-- quote can neither break the statement nor inject SQL. Note psql does NOT expand
-- :variables inside dollar-quoted strings, which is why this uses \gexec rather
-- than DO $$ ... $$.
--
-- ── Statement order is the safety property ────────────────────────────────
-- GlitchTip runs Django migrations against this database on every start, so it
-- needs ownership of it (or CREATE on it) — but NOT superuser. De-privilege
-- before confirming that, and the next GlitchTip start fails on its own
-- migration. So: establish ownership and rights FIRST, strip attributes LAST.
-- Nothing here is wrapped in a transaction, and that is deliberate given the
-- ordering: every statement is independently idempotent, and a failure part-way
-- leaves the role MORE privileged than intended, never less. Re-running
-- converges. The reverse order would have the opposite failure direction.
--
-- ── Why this role never reaches Finances ──────────────────────────────────
-- It holds no grant on the application database, and assert-grants.sql enforces
-- that rather than trusting it: the attribute sweep fails any login role that is
-- not one of the three declared service roles and yet holds CONNECT on Finances.
-- That is the same gate metabase_user passes, and it is what would catch this
-- role being widened out-of-band the way metabase_user once was.
-- ==============================================

\set ON_ERROR_STOP on

-- ── 1. Ownership of the GlitchTip database ────────────────────────────────
-- 00-create-databases.sql creates it with this owner; converged here so a
-- database that drifted to another owner is corrected rather than silently left
-- where a non-superuser GlitchTip could no longer migrate it. The join yields no
-- row — and so runs nothing — when the role is absent or already the owner.
SELECT format('ALTER DATABASE %I OWNER TO %I', d.datname, r.rolname)
FROM pg_database d
JOIN pg_roles r ON r.rolname = :'gt_user'
WHERE d.datname = current_database()
  AND d.datdba <> r.oid\gexec

-- ── 2. PUBLIC holds nothing on this database ──────────────────────────────
-- Created with no explicit ACL, which means the Postgres default: PUBLIC gets
-- CONNECT and TEMPORARY. Every role in the cluster could therefore open a
-- session on it — finance_app's credential included — and this database holds
-- GlitchTip's own users table plus every captured error message. The database
-- owner keeps its access: ownership is not an ACL entry, and step 3 grants it
-- explicitly besides.
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ── 3. The rights GlitchTip's startup migrations actually need ────────────
-- On PG15+ the database owner already holds both of these implicitly: `public`
-- is owned by pg_database_owner, which resolves to whoever owns the database.
-- They are granted explicitly anyway, because that implication is a property of
-- the server version and of who owns `public` — neither of which this file
-- controls. A database restored from an older cluster, or one whose `public`
-- schema is owned by postgres, needs the grant to be real.
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I',
              current_database(), rolname)
FROM pg_roles WHERE rolname = :'gt_user'\gexec

SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', rolname)
FROM pg_roles WHERE rolname = :'gt_user'\gexec

-- ── 4. Sync the password, strip the cluster-wide attributes ───────────────
-- Unconditional (not guarded on the current values) so it converges: an
-- attribute re-widened by hand is removed on the next `up`, exactly as
-- 02-grants.sql revokes before it grants. LOGIN is re-stated because this role
-- exists to log in; everything else is denied.
--
-- PASSWORD rides on this same statement rather than getting one of its own,
-- matching 01-create-roles.sql and 03-metabase-role.sql. One ALTER is atomic, so
-- the "a failure part-way leaves the role MORE privileged, never less" property
-- above still holds: the role keeps both its old attributes and its old
-- password, and re-running converges. This is what makes GLITCHTIP_DB_PASSWORD
-- rotatable from .env — edit it, re-run migrate, done.
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
              ' NOREPLICATION NOBYPASSRLS PASSWORD %L', rolname, :'gt_password')
FROM pg_roles WHERE rolname = :'gt_user'\gexec

-- Says which of the two things happened, since every statement above is silent
-- when the role is absent (a cluster that has never provisioned GlitchTip).
SELECT CASE
    WHEN EXISTS (SELECT FROM pg_roles WHERE rolname = :'gt_user')
    THEN format('%s converged: owns %s, USAGE+CREATE on public, no cluster '
                'attributes, password synced from GLITCHTIP_DB_PASSWORD',
                :'gt_user', current_database())
    ELSE format('role %s does not exist — nothing to converge', :'gt_user')
END AS "glitchtip role";
