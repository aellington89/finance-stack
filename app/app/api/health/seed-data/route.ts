import { auth } from "@/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { SEED_REFERENCES } from "@/lib/constants/reference-ids";
import { reportError } from "@/lib/report";

// The seed-reference drift check, split out of /api/health (#191). Diagnostic
// rather than operational: nothing polls this, and Docker no longer cycles the
// container when it fails, so the cost of its three indexed lookups is paid only
// when someone asks.
//
// Gated here in the handler rather than by adding the path to proxy.ts's matcher,
// for the same reason requireActionUser() gates each action instead of trusting
// the proxy — and because the proxy answers a denied request with a 302 to /login,
// which would hand any caller a 200 HTML page instead of a failure. A 401 is the
// honest answer for a JSON endpoint. Gating also keeps the drift payload's table
// names, ids and expected values off an unauthenticated response, and removes the
// three-query-per-request surface an anonymous caller could otherwise drive.

export interface DriftEntry {
  table: string;
  id: number;
  expected: string;
  actual: string | null;
}

export async function checkSeedReferences(): Promise<DriftEntry[]> {
  const drift: DriftEntry[] = [];

  for (const group of SEED_REFERENCES) {
    const ids = group.expected.map((r) => r.id);

    const result = await db.execute(sql`
      SELECT ${sql.identifier(group.idColumn)} AS id,
             ${sql.identifier(group.nameColumn)} AS name
      FROM ${sql.identifier(group.table)}
      WHERE ${sql.identifier(group.idColumn)} IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
    `);

    const actualById = new Map<number, string>();
    for (const row of result.rows as { id: number; name: string }[]) {
      actualById.set(row.id, row.name);
    }

    for (const expected of group.expected) {
      const actual = actualById.get(expected.id) ?? null;
      if (actual !== expected.name) {
        drift.push({
          table: group.table,
          id: expected.id,
          expected: expected.name,
          actual,
        });
      }
    }
  }

  return drift;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json(
      { status: "error", error: "unauthorized" },
      { status: 401 },
    );
  }

  // No SELECT 1 first: the drift queries are their own liveness signal, and
  // /api/health is where a caller asks that question.
  let drift: DriftEntry[];
  try {
    drift = await checkSeedReferences();
  } catch (err) {
    reportError(err, { route: "/api/health/seed-data" });
    return Response.json(
      { status: "error", db: "connected", seedData: "error" },
      { status: 503 },
    );
  }

  if (drift.length > 0) {
    return Response.json(
      { status: "error", db: "connected", seedData: "drift", drift },
      { status: 503 },
    );
  }

  return Response.json({ status: "ok", db: "connected", seedData: "ok" });
}
