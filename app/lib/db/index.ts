// Database client — Drizzle ORM connection to PostgreSQL.
// Will be configured in Issue #19 using the DATABASE_URL
// environment variable from .env.local.
//
// Planned implementation:
//   import { drizzle } from "drizzle-orm/node-postgres";
//   import { Pool } from "pg";
//   import * as schema from "./schema";
//
//   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
//   export const db = drizzle(pool, { schema });
