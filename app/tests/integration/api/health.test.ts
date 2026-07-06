import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { GET } from "@/app/api/health/route";
import { OPENING_BALANCE_TYPE } from "@/lib/constants/reference-ids";

async function restoreOpeningBalanceTypeName() {
  await db.execute(sql`
    UPDATE transaction_types
    SET transaction_type = ${OPENING_BALANCE_TYPE.name}
    WHERE transaction_type_id = ${OPENING_BALANCE_TYPE.id}
  `);
}

describe("GET /api/health", () => {
  afterEach(restoreOpeningBalanceTypeName);

  it("returns 200 with seedData: ok and build metadata when seed rows are intact", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(body.seedData).toBe("ok");
    expect(body.build).toEqual({
      version: expect.any(String),
      gitSha: expect.any(String),
      buildTime: expect.any(String),
    });
    // Without build-time env injection (next dev / test), gitSha falls back to "dev".
    expect(body.build.gitSha).toBe("dev");
  });

  it("returns 503 with a drift entry when a seed row has been renamed", async () => {
    await db.execute(sql`
      UPDATE transaction_types
      SET transaction_type = 'RENAMED_BY_TEST'
      WHERE transaction_type_id = ${OPENING_BALANCE_TYPE.id}
    `);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.seedData).toBe("drift");
    expect(body.drift).toContainEqual({
      table: "transaction_types",
      id: OPENING_BALANCE_TYPE.id,
      expected: OPENING_BALANCE_TYPE.name,
      actual: "RENAMED_BY_TEST",
    });
  });
});
