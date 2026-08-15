-- Normalise before constraining (issue #87). `users.role` has been free text
-- with a default of 'admin' since issue #120 and nothing ever wrote another
-- value — auth:create-user did not set the column at all — so on any install
-- this is a no-op. It runs anyway because the alternative is a migration that
-- aborts on a database somebody edited by hand, and the repair for that is
-- worse than the statement. Hand-authored; drizzle-kit does not model data
-- migrations (see docs/schema-changes.md step 4).
UPDATE users SET role = 'admin' WHERE role NOT IN ('admin', 'user');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_valid" CHECK (role = ANY (ARRAY['admin'::text, 'user'::text]));
