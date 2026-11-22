// Shared audit_log watermark for the integration suites (PR #486). Not a
// *.test.ts file, so the integration project's include glob doesn't collect it.
//
// Take the watermark before the action and read only rows above it. Matching
// on row_pk alone isn't enough: a test database whose sequences were reset
// reuses ids that older audit rows still name.

import { gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog } from "@/drizzle/schema";

/** The highest audit_id so far, or 0. int8 arrives from pg as a string. */
export async function maxAuditId(): Promise<number> {
  const [{ max }] = await db
    .select({ max: sql<string>`coalesce(max(${auditLog.auditId}), 0)` })
    .from(auditLog);
  return Number(max);
}

/** The ids of every audit row written after `watermark`. */
export async function auditRowsSince(watermark: number) {
  return db.select({ id: auditLog.auditId }).from(auditLog).where(gt(auditLog.auditId, watermark));
}
