import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { SEED_REFERENCES } from "@/lib/constants/reference-ids";
import { BUILD_INFO } from "@/lib/version";

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
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    return Response.json(
      { status: "error", db: "disconnected" },
      { status: 503 },
    );
  }

  let drift: DriftEntry[];
  try {
    drift = await checkSeedReferences();
  } catch (err) {
    console.error("Seed-reference health check failed:", err);
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

  return Response.json({
    status: "ok",
    db: "connected",
    seedData: "ok",
    build: BUILD_INFO,
  });
}
