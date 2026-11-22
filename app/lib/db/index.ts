import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/drizzle/schema";
import * as relations from "@/drizzle/relations";

// One Pool per process, cached on globalThis. In development that survives
// hot-module reloads, which would otherwise open a new pool each cycle and
// eventually exhaust the PostgreSQL connection limit. In production it covers
// the recurring-transaction scheduler (Issue #135): instrumentation.ts loads
// it outside the app's routes, and a module graph of its own would evaluate
// this file again and open a second pool. globalThis is shared either way.
const globalForDb = globalThis as unknown as { pool: Pool };

const pool =
  globalForDb.pool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

globalForDb.pool = pool;

export const db = drizzle(pool, { schema: { ...schema, ...relations } });
