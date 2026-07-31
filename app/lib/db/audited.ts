import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";

/**
 * The transaction handle drizzle hands a `db.transaction` callback. Exported so
 * helpers like rebuildAccountBalance() can keep taking a `tx` without every
 * caller re-deriving the type.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` in a database transaction that knows who is making the change.
 *
 * Audit rows are written by the `audit_row_change()` trigger installed in
 * migration 0004, not by application code (Issue #180). The trigger reads the
 * actor from two GUCs, which this is the only thing that sets — so every
 * mutating server action must go through here rather than calling
 * `db.transaction` or a bare `db.insert/update/delete` directly. A write that
 * skips this is still audited, just attributed to the database role instead of
 * the signed-in user.
 *
 * The third argument to `set_config` is `true`, meaning transaction-local, and
 * it is load-bearing: `db` is a shared `pg.Pool` (lib/db/index.ts), so a
 * session-scoped setting would outlive this request on that pooled connection
 * and mis-attribute the next user's writes. It is also why the writes have to
 * be inside an explicit transaction at all — a bare `db.update(...)` runs in an
 * implicit one, leaving nowhere safe to put the actor.
 *
 * `auth()` is called here as well as in requireActionUser(); it decodes the
 * session cookie and makes no database round-trip, so resolving it twice is
 * cheaper than reshaping the guard's signature across every call site.
 *
 * See docs/audit-log.md.
 */
export async function auditedTransaction<T>(
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  const session = await auth();
  const actorUserId = session?.user?.id ?? "";
  const actorLabel = session?.user?.name ?? "";

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT set_config('app.actor_user_id', ${actorUserId}, true),
             set_config('app.actor_label', ${actorLabel}, true)
    `);
    return fn(tx);
  });
}
