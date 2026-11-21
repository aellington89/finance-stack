import { describe, it, expect, afterEach, vi } from "vitest";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountBalanceHistory,
  accounts,
  recurringTransactions,
  transactions,
} from "@/drizzle/schema";
import {
  MATERIALIZE_CAP,
  currentDate,
  materializeTemplate,
  runDueTemplates,
} from "@/lib/recurring/materialize";
import { systemTransaction } from "@/lib/db/system-transaction";
import { occurrenceDate, type Cadence } from "@/lib/recurring/schedule";

/**
 * The materializer against Postgres (Issue #135). "Today" is injected as a
 * 2020 date, so every row sits outside the seeded mock-data window, and the
 * tests don't depend on what day they run on. Each test makes its own
 * accounts and templates. runDueTemplates() scans every template in the
 * database, so assertions are about this test's templates, never the run's
 * totals alone.
 */

const TODAY = "2020-06-10";

const createdAccountIds: number[] = [];

async function createAccount(name: string, closedDate: string | null = null): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId: 1, closedDate })
    .returning({ accountId: accounts.accountId });
  createdAccountIds.push(row.accountId);
  return row.accountId;
}

interface TemplateInput {
  accountId: number;
  relatedAccountId?: number | null;
  cadence?: Cadence;
  every?: number;
  anchorDate: string;
  nextRunDate?: string;
  endDate?: string | null;
  isActive?: boolean;
  amount?: string;
  description?: string;
  typeId?: number;
  categoryId?: number;
}

async function createTemplate(input: TemplateInput): Promise<number> {
  const [row] = await db
    .insert(recurringTransactions)
    .values({
      transactionDescription: input.description ?? "Recurring test",
      amount: input.amount ?? "-25.00",
      accountId: input.accountId,
      relatedAccountId: input.relatedAccountId ?? null,
      transactionTypeId: input.typeId ?? 1,
      transactionCategoryId: input.categoryId ?? 1,
      cadence: input.cadence ?? "daily",
      intervalCount: input.every ?? 1,
      anchorDate: input.anchorDate,
      nextRunDate: input.nextRunDate ?? input.anchorDate,
      endDate: input.endDate ?? null,
      isActive: input.isActive ?? true,
    })
    .returning({ id: recurringTransactions.recurringTransactionId });
  return row.id;
}

async function createdRows(templateId: number) {
  return db
    .select({
      transactionId: transactions.transactionId,
      transactionDate: transactions.transactionDate,
      occurrence: transactions.recurringOccurrenceDate,
      amount: transactions.amount,
      accountId: transactions.accountId,
      description: transactions.transactionDescription,
      relatedAccountId: transactions.relatedAccountId,
      typeId: transactions.transactionTypeId,
      categoryId: transactions.transactionCategoryId,
    })
    .from(transactions)
    .where(eq(transactions.recurringTransactionId, templateId))
    .orderBy(asc(transactions.recurringOccurrenceDate));
}

async function template(id: number) {
  const [row] = await db
    .select()
    .from(recurringTransactions)
    .where(eq(recurringTransactions.recurringTransactionId, id));
  return row;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (createdAccountIds.length === 0) return;
  // Templates first: their account FKs are RESTRICT.
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.accountId, createdAccountIds));
  await db.delete(transactions).where(inArray(transactions.accountId, createdAccountIds));
  await db.delete(accountBalanceHistory).where(inArray(accountBalanceHistory.accountId, createdAccountIds));
  await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
  createdAccountIds.length = 0;
});

describe("runDueTemplates", () => {
  it("creates exactly one transaction for a template due today, and advances it (AC1, AC2)", async () => {
    const accountId = await createAccount("Recurring: due today");
    const relatedAccountId = await createAccount("Recurring: due today (related)");
    const id = await createTemplate({
      accountId,
      relatedAccountId,
      anchorDate: TODAY,
      amount: "-12.34",
      description: "Rent",
      typeId: 2,
      categoryId: 3,
    });

    const summary = await runDueTemplates({ today: TODAY });

    expect(summary.failed).toBe(0);
    const rows = await createdRows(id);
    expect(rows).toEqual([
      expect.objectContaining({
        transactionDate: TODAY,
        occurrence: TODAY,
        description: "Rent",
        amount: "-12.34",
        accountId,
        relatedAccountId,
        typeId: 2,
        categoryId: 3,
      }),
    ]);
    expect((await template(id)).nextRunDate).toBe("2020-06-11");
  });

  it("creates nothing more when run again the same day (AC3)", async () => {
    const accountId = await createAccount("Recurring: rerun");
    const id = await createTemplate({ accountId, anchorDate: TODAY });

    await runDueTemplates({ today: TODAY });
    await runDueTemplates({ today: TODAY });

    expect(await createdRows(id)).toHaveLength(1);
  });

  it("creates each occurrence once when two runs race (AC3)", async () => {
    const accountId = await createAccount("Recurring: race");
    const id = await createTemplate({ accountId, anchorDate: "2020-06-08" });

    await Promise.all([runDueTemplates({ today: TODAY }), runDueTemplates({ today: TODAY })]);

    expect((await createdRows(id)).map((r) => r.occurrence)).toEqual(["2020-06-08", "2020-06-09", "2020-06-10"]);
    expect((await template(id)).nextRunDate).toBe("2020-06-11");
  });

  it("backfills each missed occurrence on its own date (AC5)", async () => {
    const accountId = await createAccount("Recurring: backfill");
    const id = await createTemplate({ accountId, anchorDate: "2020-06-07" });

    await runDueTemplates({ today: TODAY });

    expect((await createdRows(id)).map((r) => r.transactionDate)).toEqual([
      "2020-06-07", "2020-06-08", "2020-06-09", "2020-06-10",
    ]);
  });

  it("stops at the cap and carries on from there next run (AC6)", async () => {
    const accountId = await createAccount("Recurring: cap");
    const id = await createTemplate({ accountId, anchorDate: "2020-06-05" });

    await runDueTemplates({ today: TODAY, cap: 2 });
    expect((await createdRows(id)).map((r) => r.occurrence)).toEqual(["2020-06-05", "2020-06-06"]);
    expect((await template(id)).nextRunDate).toBe("2020-06-07");

    await runDueTemplates({ today: TODAY, cap: 10 });
    expect(await createdRows(id)).toHaveLength(6);
  });

  it("stops at the default cap of 400 when none is given, and carries on next run (AC6)", async () => {
    const accountId = await createAccount("Recurring: default cap");
    // 527 daily occurrences, 2019-01-01 through TODAY.
    const id = await createTemplate({ accountId, anchorDate: "2019-01-01" });

    await runDueTemplates({ today: TODAY });
    const first = await createdRows(id);
    expect(first).toHaveLength(400);
    expect(first.at(-1)?.occurrence).toBe("2020-02-04");
    expect((await template(id)).nextRunDate).toBe("2020-02-05");

    await runDueTemplates({ today: TODAY });
    const all = await createdRows(id);
    expect(all).toHaveLength(527);
    expect(all.at(-1)?.occurrence).toBe(TODAY);
  });

  it("keeps a monthly 31st anchored across short months (AC7)", async () => {
    const accountId = await createAccount("Recurring: month end");
    const id = await createTemplate({ accountId, cadence: "monthly", anchorDate: "2020-01-31" });

    await runDueTemplates({ today: "2020-04-30" });

    expect((await createdRows(id)).map((r) => r.occurrence)).toEqual([
      "2020-01-31", "2020-02-29", "2020-03-31", "2020-04-30",
    ]);
    expect((await template(id)).nextRunDate).toBe("2020-05-31");
  });

  it("creates nothing for a paused template (AC8)", async () => {
    const accountId = await createAccount("Recurring: paused");
    const id = await createTemplate({ accountId, anchorDate: "2020-06-01", isActive: false });

    const summary = await runDueTemplates({ today: TODAY });

    expect(await createdRows(id)).toHaveLength(0);
    expect((await template(id)).nextRunDate).toBe("2020-06-01");
    expect(summary.failed).toBe(0);
  });

  it("stops at the end date, inclusive, and leaves an ended template alone (AC9)", async () => {
    const accountId = await createAccount("Recurring: ends");
    const id = await createTemplate({ accountId, cadence: "weekly", anchorDate: "2020-05-20", endDate: "2020-06-03" });

    await runDueTemplates({ today: TODAY });
    expect((await createdRows(id)).map((r) => r.occurrence)).toEqual(["2020-05-20", "2020-05-27", "2020-06-03"]);
    const ended = await template(id);
    expect(ended.nextRunDate).toBe("2020-06-10");
    expect(ended.isActive).toBe(true);

    // Ended, it is no longer due: a later run neither creates nor locks it.
    const later = await runDueTemplates({ today: "2020-07-01" });
    expect(await createdRows(id)).toHaveLength(3);
    expect(later.failed).toBe(0);
  });

  it("puts the created amounts into balance history at once (AC10)", async () => {
    const accountId = await createAccount("Recurring: balances");
    const relatedId = await createAccount("Recurring: balances (related)");
    await createTemplate({ accountId, relatedAccountId: relatedId, anchorDate: "2020-06-09", amount: "-40.00" });

    await runDueTemplates({ today: TODAY });

    const realToday = await currentDate();
    const [row] = await db
      .select({ cumulative: accountBalanceHistory.cumulativeBalance })
      .from(accountBalanceHistory)
      .where(and(eq(accountBalanceHistory.accountId, accountId), eq(accountBalanceHistory.balanceDate, realToday)));
    expect(row.cumulative).toBe("-80.00");
  });

  it("doesn't recreate a deleted occurrence, and keeps rows when the template goes (AC11)", async () => {
    const accountId = await createAccount("Recurring: deletes");
    const id = await createTemplate({ accountId, anchorDate: "2020-06-09" });
    await runDueTemplates({ today: TODAY });
    const [firstRow] = await createdRows(id);

    await db.delete(transactions).where(eq(transactions.transactionId, firstRow.transactionId));
    await runDueTemplates({ today: TODAY });
    expect((await createdRows(id)).map((r) => r.occurrence)).toEqual(["2020-06-10"]);

    await db.delete(recurringTransactions).where(eq(recurringTransactions.recurringTransactionId, id));
    expect(await createdRows(id)).toHaveLength(1);
  });

  it("creates only the occurrences before a closed account's close date, then pauses (AC12)", async () => {
    const accountId = await createAccount("Recurring: closed", "2020-06-09");
    const id = await createTemplate({ accountId, anchorDate: "2020-06-07" });
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const summary = await runDueTemplates({ today: TODAY });

    expect((await createdRows(id)).map((r) => r.occurrence)).toEqual(["2020-06-07", "2020-06-08"]);
    const paused = await template(id);
    expect(paused.isActive).toBe(false);
    expect(paused.nextRunDate).toBe("2020-06-09");
    expect(summary.paused).toBeGreaterThanOrEqual(1);
    const warning = consoleWarn.mock.calls.map((c) => JSON.parse(c[0] as string)).find((r) => r.recurring_transaction_id === id);
    expect(warning).toMatchObject({ level: "warn", msg: "recurring transaction paused: its account is closed" });
  });

  it("reports a template that fails, and still runs the others (AC14)", async () => {
    const accountId = await createAccount("Recurring: isolation");
    // next_run_date (the 15th) isn't an occurrence of a monthly schedule
    // anchored on the 1st: a row hand-edited around the app.
    const broken = await createTemplate({ accountId, cadence: "monthly", anchorDate: "2020-06-01", nextRunDate: "2020-06-05" });
    const healthy = await createTemplate({ accountId, anchorDate: TODAY });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const summary = await runDueTemplates({ today: TODAY });

    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(await createdRows(broken)).toHaveLength(0);
    expect((await template(broken)).nextRunDate).toBe("2020-06-05");
    expect(await createdRows(healthy)).toHaveLength(1);

    const report = consoleError.mock.calls.map((c) => JSON.parse(c[0] as string)).find((r) => r.recurring_transaction_id === broken);
    expect(report).toMatchObject({
      level: "error",
      msg: "recurring-schedule failed",
      job: "recurring-schedule",
      err: { name: "RangeError", message: expect.stringMatching(/not an occurrence/) },
    });
  });

  it("sends a failed template to GlitchTip, with its id and the job's tag, when ERROR_DSN is set (AC14)", async () => {
    const accountId = await createAccount("Recurring: glitchtip");
    const broken = await createTemplate({ accountId, cadence: "monthly", anchorDate: "2020-06-01", nextRunDate: "2020-06-05" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ERROR_DSN", "http://publickey123@glitchtip:8000/1");

    try {
      await runDueTemplates({ today: TODAY });
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }

    const events = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => ({
      url,
      event: JSON.parse((init.body as string).split("\n")[2]) as {
        tags: Record<string, unknown>;
        extra: Record<string, unknown>;
        exception: { values: { type: string }[] };
      },
    }));
    const sent = events.find((e) => e.event.extra.recurring_transaction_id === broken);
    expect(sent?.url).toBe("http://glitchtip:8000/api/1/envelope/");
    expect(sent?.event.tags).toMatchObject({ job: "recurring-schedule" });
    expect(sent?.event.exception.values[0].type).toBe("RangeError");
  });

  it("fails a template loudly, not silently, when its row lock is held past the timeout (AC14)", async () => {
    const accountId = await createAccount("Recurring: held");
    const id = await createTemplate({ accountId, anchorDate: TODAY });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let markLocked!: () => void;
    const locked = new Promise<void>((r) => (markLocked = r));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM recurring_transactions WHERE recurring_transaction_id = ${id} FOR UPDATE`);
      markLocked();
      await released;
    });
    await locked;

    const summary = await runDueTemplates({ today: TODAY, lockTimeout: "200ms" }).finally(release);
    await holder;

    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(await createdRows(id)).toHaveLength(0);
    const report = consoleError.mock.calls.map((c) => JSON.parse(c[0] as string)).find((r) => r.recurring_transaction_id === id);
    expect(report).toMatchObject({ msg: "recurring-schedule failed", err: { cause: { code: "55P03" } } });

    // Released, the next run picks it up.
    await runDueTemplates({ today: TODAY });
    expect(await createdRows(id)).toHaveLength(1);
  });

  it("sees an account closed while the run waits for it, and pauses (AC12)", async () => {
    const accountId = await createAccount("Recurring: closing");
    const id = await createTemplate({ accountId, anchorDate: "2020-06-08" });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // The account is being closed in a transaction that hasn't committed yet.
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let markUpdated!: () => void;
    const updated = new Promise<void>((r) => (markUpdated = r));
    const closer = db.transaction(async (tx) => {
      await tx.update(accounts).set({ closedDate: TODAY }).where(eq(accounts.accountId, accountId));
      markUpdated();
      await released;
    });
    await updated;

    const run = runDueTemplates({ today: TODAY });
    // Commit the close once the run is waiting on the account row. A run that
    // doesn't wait never shows up here, and is let through after 2 s.
    for (let i = 0; i < 40; i++) {
      const waiting = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      `);
      if (waiting.rows[0].n > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    release();
    await closer;
    await run;

    expect((await createdRows(id)).map((r) => r.occurrence)).toEqual(["2020-06-08", "2020-06-09"]);
    const paused = await template(id);
    expect(paused.isActive).toBe(false);
    expect(paused.nextRunDate).toBe(TODAY);
  });
});

describe("materializeTemplate", () => {
  it("skips a template that isn't due", async () => {
    const accountId = await createAccount("Recurring: not due");
    const id = await createTemplate({ accountId, anchorDate: "2020-06-11" });

    const outcome = await systemTransaction("test", (tx) => materializeTemplate(tx, id, { today: TODAY }));

    expect(outcome).toEqual({ created: 0, pausedForClosedAccount: false, skipped: true });
  });

  it("treats an occurrence that already exists as a no-op, and says so (AC3)", async () => {
    const accountId = await createAccount("Recurring: conflict");
    const id = await createTemplate({ accountId, anchorDate: TODAY });
    // The occurrence exists already, though next_run_date still names it.
    await db.insert(transactions).values({
      transactionDescription: "Pre-existing occurrence",
      transactionDate: TODAY,
      accountId,
      amount: "-25.00",
      transactionTypeId: 1,
      transactionCategoryId: 1,
      recurringTransactionId: id,
      recurringOccurrenceDate: TODAY,
    });
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await systemTransaction("test", (tx) => materializeTemplate(tx, id, { today: TODAY }));

    expect(outcome).toEqual({ created: 0, pausedForClosedAccount: false, skipped: false });
    expect(await createdRows(id)).toHaveLength(1);
    expect((await template(id)).nextRunDate).toBe("2020-06-11");
    const warning = JSON.parse(consoleWarn.mock.calls[0][0] as string);
    expect(warning).toMatchObject({ msg: "recurring occurrence already existed; skipped", attempted: 1, created: 0 });
  });

  it("uses the default cap", () => {
    expect(MATERIALIZE_CAP).toBe(400);
  });
});

describe("the link pair's constraints", () => {
  it("rejects a second row for the same occurrence", async () => {
    const accountId = await createAccount("Recurring: unique");
    const id = await createTemplate({ accountId, anchorDate: TODAY });
    const row = {
      transactionDescription: "Occurrence",
      transactionDate: TODAY,
      accountId,
      amount: "-1.00",
      transactionTypeId: 1,
      transactionCategoryId: 1,
      recurringTransactionId: id,
      recurringOccurrenceDate: TODAY,
    };
    await db.insert(transactions).values(row);
    await expect(db.insert(transactions).values(row)).rejects.toMatchObject({
      cause: { code: "23505", constraint: "transactions_recurring_occurrence_key" },
    });
    expect(await createdRows(id)).toHaveLength(1);
  });

  it("allows any number of hand-entered rows (both columns NULL)", async () => {
    const accountId = await createAccount("Recurring: nulls distinct");
    const row = {
      transactionDescription: "By hand",
      transactionDate: TODAY,
      accountId,
      amount: "-1.00",
      transactionTypeId: 1,
      transactionCategoryId: 1,
    };
    await db.insert(transactions).values([row, row]);
    const rows = await db.select().from(transactions).where(eq(transactions.accountId, accountId));
    expect(rows).toHaveLength(2);
  });

  it("rejects a link with no occurrence date, and the reverse", async () => {
    const accountId = await createAccount("Recurring: pair");
    const base = {
      transactionDescription: "Half a link",
      transactionDate: TODAY,
      accountId,
      amount: "-1.00",
      transactionTypeId: 1,
      transactionCategoryId: 1,
    };
    await expect(db.insert(transactions).values({ ...base, recurringTransactionId: 1 })).rejects.toMatchObject({
      cause: { code: "23514", constraint: "transactions_recurring_link_pair" },
    });
    await expect(db.insert(transactions).values({ ...base, recurringOccurrenceDate: TODAY })).rejects.toMatchObject({
      cause: { code: "23514", constraint: "transactions_recurring_link_pair" },
    });
  });

  it("enforces the template CHECKs", async () => {
    const accountId = await createAccount("Recurring: checks");
    const relatedId = await createAccount("Recurring: checks (other)");
    const bad: Array<[Partial<TemplateInput> & { cadence?: string }, string]> = [
      [{ cadence: "hourly" as Cadence }, "recurring_transactions_cadence_check"],
      [{ every: 0 }, "recurring_transactions_interval_count_range"],
      [{ every: 100 }, "recurring_transactions_interval_count_range"],
      [{ nextRunDate: "2020-06-09" }, "recurring_transactions_next_not_before_anchor"],
      [{ endDate: "2020-06-09" }, "recurring_transactions_end_not_before_anchor"],
      [{ relatedAccountId: accountId }, "recurring_transactions_related_differs"],
    ];
    for (const [overrides, constraint] of bad) {
      await expect(createTemplate({ accountId, anchorDate: TODAY, ...overrides } as TemplateInput)).rejects.toMatchObject({
        cause: { code: "23514", constraint },
      });
    }
    // A related account that differs is fine.
    await createTemplate({ accountId, relatedAccountId: relatedId, anchorDate: TODAY });
  });

  it("refuses to delete an account a template uses (RESTRICT)", async () => {
    const accountId = await createAccount("Recurring: restrict");
    await createTemplate({ accountId, anchorDate: "2030-01-01" });
    await expect(db.delete(accounts).where(eq(accounts.accountId, accountId))).rejects.toMatchObject({
      cause: { code: "23001", constraint: "recurring_transactions_account_id_fkey" },
    });
  });
});

describe("date parity with Postgres", () => {
  // Postgres clamps `date + interval 'k months'` the way schedule.ts does. If
  // they ever disagreed, the forecast (TypeScript) and anything written in SQL
  // would name different days.
  it.each(["2020-01-28", "2020-01-29", "2020-01-30", "2020-01-31", "2019-02-28", "2020-02-29", "2021-08-31"])(
    "agrees for a monthly schedule anchored on %s",
    async (anchorDate) => {
      const ks = Array.from({ length: 30 }, (_, k) => k);
      const result = await db.execute<{ k: number; d: string }>(sql`
        SELECT k, (${anchorDate}::date + make_interval(months => k))::date::text AS d
        FROM unnest(${sql.param(ks)}::int[]) AS k ORDER BY k
      `);
      const fromSql = result.rows.map((r) => r.d);
      const fromTs = ks.map((k) => occurrenceDate({ cadence: "monthly", every: 1, anchorDate, endDate: null }, k));
      expect(fromTs).toEqual(fromSql);
    }
  );

  it("agrees for a yearly Feb 29", async () => {
    const result = await db.execute<{ d: string }>(sql`
      SELECT ('2020-02-29'::date + make_interval(years => k))::date::text AS d FROM generate_series(0, 8) AS k ORDER BY k
    `);
    const fromTs = Array.from({ length: 9 }, (_, k) =>
      occurrenceDate({ cadence: "yearly", every: 1, anchorDate: "2020-02-29", endDate: null }, k)
    );
    expect(fromTs).toEqual(result.rows.map((r) => r.d));
  });
});
