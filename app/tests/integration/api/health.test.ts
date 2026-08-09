import { describe, it, expect, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { GET } from "@/app/api/health/route";
import { OPENING_BALANCE_TYPE } from "@/lib/constants/reference-ids";
import { restoreTransactionTypes } from "./seed-rows";

describe("GET /api/health (liveness)", () => {
  afterEach(restoreTransactionTypes);

  it("returns 200 with build metadata and no seed-data verdict", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(body.build).toEqual({
      version: expect.any(String),
      gitSha: expect.any(String),
      buildTime: expect.any(String),
    });
    // Without build-time env injection (next dev / test), gitSha falls back to "dev".
    expect(body.build.gitSha).toBe("dev");

    // The split (#191): seed-row state is no longer this endpoint's business.
    expect(body).not.toHaveProperty("seedData");
    expect(body).not.toHaveProperty("drift");
  });

  // The point of #191. Before the split this renamed row produced a 503, which
  // marked the container unhealthy for a data problem no restart could fix — and
  // a fresh Finances, whose transaction_categories are user-created, hit the same
  // path from first boot (#178).
  it("stays 200 when a seed row has drifted", async () => {
    await db.execute(sql`
      UPDATE transaction_types
      SET transaction_type = 'RENAMED_BY_TEST'
      WHERE transaction_type_id = ${OPENING_BALANCE_TYPE.id}
    `);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  // Acceptance criterion: exactly one liveness query. The endpoint is polled every
  // 10s by the Docker healthcheck, and the pre-split version paid for three extra
  // indexed lookups on top of this one. Spies are restored inline rather than with
  // vi.restoreAllMocks(), which would also strip the authenticated-session
  // implementation vitest-setup.ts installs on the shared @/auth mock — the run
  // uses one process (fileParallelism: false), so that leaks into later files.
  it("runs exactly one query per request", async () => {
    const executeSpy = vi.spyOn(db, "execute");

    try {
      await GET();
      expect(executeSpy).toHaveBeenCalledTimes(1);
    } finally {
      executeSpy.mockRestore();
    }
  });

  it("returns 503 when the database is unreachable", async () => {
    const executeSpy = vi
      .spyOn(db, "execute")
      .mockRejectedValueOnce(new Error("connection refused"));

    try {
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.status).toBe("error");
      expect(body.db).toBe("disconnected");
    } finally {
      executeSpy.mockRestore();
    }
  });
});
