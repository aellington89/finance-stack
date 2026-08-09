import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { BUILD_INFO } from "@/lib/version";

// Liveness only (#191): one query, no seed-row inspection. This is the target of
// the Compose healthcheck and the release smoke test, and it is one of the few
// public routes, so it stays cheap enough to poll every 10s and discloses nothing
// beyond the build stamp. Seed-row drift moved to /api/health/seed-data — it is a
// data problem a container restart cannot fix, so it must not drive restart policy,
// and a fresh Finances (no user-created transaction_categories) legitimately trips
// it while being perfectly alive.
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    return Response.json(
      { status: "error", db: "disconnected" },
      { status: 503 },
    );
  }

  return Response.json({
    status: "ok",
    db: "connected",
    build: BUILD_INFO,
  });
}
