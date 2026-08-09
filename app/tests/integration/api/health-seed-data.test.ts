import { describe, it, expect, afterEach } from "vitest";
import type { Mock } from "vitest";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { GET } from "@/app/api/health/seed-data/route";
import { OPENING_BALANCE_TYPE, WORK_EXPENSE_TYPE } from "@/lib/constants/reference-ids";
import { restoreTransactionTypes } from "./seed-rows";

// vitest-setup.ts mocks @/auth with an authenticated session by default, so the
// drift cases below need no sign-in ceremony; the 401 case overrides it once.
const mockedAuth = auth as unknown as Mock;

describe("GET /api/health/seed-data", () => {
  afterEach(restoreTransactionTypes);

  it("returns 401 without a session and does not touch the database", async () => {
    mockedAuth.mockResolvedValueOnce(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ status: "error", error: "unauthorized" });
    // The drift detail — table names, ids, expected values — stays behind the gate.
    expect(body).not.toHaveProperty("drift");
  });

  it("returns 200 with seedData: ok when seed rows are intact", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(body.seedData).toBe("ok");
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

  // The failure mode from Issue #187: production was missing transaction_types
  // id=12 entirely, which reports `actual: null` rather than a wrong name.
  // Deletes id=5 rather than id=12 because the Finances_Test fixture posts
  // opening-balance transactions against 12, and the FK would block the delete;
  // id 5 is in SEED_REFERENCES but unreferenced by any mock transaction.
  it("returns 503 with actual: null when a seed row is missing entirely", async () => {
    await db.execute(sql`
      DELETE FROM transaction_types WHERE transaction_type_id = ${WORK_EXPENSE_TYPE.id}
    `);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.seedData).toBe("drift");
    expect(body.drift).toContainEqual({
      table: "transaction_types",
      id: WORK_EXPENSE_TYPE.id,
      expected: WORK_EXPENSE_TYPE.name,
      actual: null,
    });
  });

  // The shape of the fix: shared-lookups.sql is now applied to Finances on every
  // migrate run, so re-applying its INSERT restores a dropped reference row.
  it("returns to 200 once the missing row is re-seeded", async () => {
    await db.execute(sql`
      DELETE FROM transaction_types WHERE transaction_type_id = ${WORK_EXPENSE_TYPE.id}
    `);
    expect((await GET()).status).toBe(503);

    await restoreTransactionTypes();

    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).seedData).toBe("ok");
  });
});
