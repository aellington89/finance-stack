import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
// Type-only, so erased at compile time: audited.ts imports @/auth, and nothing
// of next-auth may load into the scheduler, which runs outside any request.
import type { Tx } from "@/lib/db/audited";

/**
 * Runs `fn` in a database transaction attributed to a named background job
 * rather than a signed-in user (Issue #135).
 *
 * auditedTransaction() can't serve a job. It calls auth(), which reads the
 * request's headers and throws outside a request. This sets only
 * `app.actor_label`, and sets `app.actor_user_id` to empty explicitly, so the
 * audit trigger records `actor_source = 'database'` with the job's label
 * instead of the database role:
 *
 *   | actor_source | actor_user_id | actor_label        |
 *   | database     | NULL          | recurring-schedule |
 *
 * Both settings are transaction-local (`set_config(…, true)`), for the
 * pooled-connection reason auditedTransaction() documents.
 *
 * `lockTimeout` bounds the transaction's lock waits. A job has no user waiting
 * on it, so without a bound a stuck holder would stall it silently and
 * indefinitely. With one, the wait fails as SQLSTATE 55P03 and the job reports
 * it. A statement that sets its own bound keeps it: a balance rebuild waits up
 * to REBUILD_LOCK_TIMEOUT for its advisory lock (lib/queries/rebuild-balance.ts).
 *
 * See docs/audit-log.md.
 */
export async function systemTransaction<T>(
  label: string,
  fn: (tx: Tx) => Promise<T>,
  options: { lockTimeout?: string } = {}
): Promise<T> {
  if (!label) throw new Error("systemTransaction needs a non-empty actor label");

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT set_config('app.actor_label', ${label}, true),
             set_config('app.actor_user_id', '', true)
    `);
    if (options.lockTimeout) {
      await tx.execute(sql`SELECT set_config('lock_timeout', ${options.lockTimeout}, true)`);
    }
    return fn(tx);
  });
}
