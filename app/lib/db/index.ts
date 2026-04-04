import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/drizzle/schema";
import * as relations from "@/drizzle/relations";

// Reuse a single Pool instance across hot-module reloads in development.
// Without this, each HMR cycle would open a new pool and eventually exhaust
// the PostgreSQL connection limit.
const globalForDb = globalThis as unknown as { pool: Pool };

const pool =
  globalForDb.pool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema: { ...schema, ...relations } });
