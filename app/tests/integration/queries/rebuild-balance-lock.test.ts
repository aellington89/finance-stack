import { describe, it, expect, afterEach, vi } from "vitest";
import { sql, eq, and, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, accountBalanceHistory, transactions } from "@/drizzle/schema";
import {
  BalanceRebuildLockTimeoutError,
  REBUILD_LOCK_NAMESPACE,
  lockAccountBalance,
  rebuildAccountBalance,
  rebuildAccountBalances,
} from "@/lib/queries/rebuild-balance";
import { reportError } from "@/lib/report";

/**
 * The balance-rebuild lock (Issue #463). Every test here sets up an
 * interleaving deterministically: one gate says the first transaction holds
 * the lock, another holds it open, and waitForBlockedSessions() proves the
 * second is actually blocked before it is released. Nothing depends on a sleep
 * being long enough.
 */

const createdAccountIds: number[] = [];

async function createAccount(name: string): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ accountName: name, accountTypeId: 1 })
    .returning({ accountId: accounts.accountId });
  createdAccountIds.push(row.accountId);
  return row.accountId;
}

const insertRow = (accountId: number, amount: string) => ({
  transactionDescription: "Rebuild lock test",
  transactionDate: "2020-03-01",
  accountId,
  amount,
  transactionTypeId: 1,
  transactionCategoryId: 1,
});

function gate(): { open: () => void; wait: Promise<void> } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { open, wait };
}

/**
 * Polls until `n` sessions in this database are blocked on a lock: any lock,
 * not only the rebuild lock. That matters for the race test: with the lock
 * removed, the second writer still blocks (on the first one's uncommitted
 * balance rows), and the test then shows what the lock prevents, a silently
 * wrong balance, rather than failing on its own setup.
 */
async function waitForBlockedSessions(n: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const result = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `);
    if (result.rows[0].waiting >= n) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${n} blocked session(s)`);
}

/** How many sessions are waiting on a rebuild lock specifically. */
async function rebuildLockWaiters(): Promise<number> {
  const result = await db.execute<{ waiting: number }>(sql`
    SELECT count(*)::int AS waiting FROM pg_locks
    WHERE locktype = 'advisory' AND classid = ${REBUILD_LOCK_NAMESPACE} AND NOT granted
  `);
  return result.rows[0].waiting;
}

async function cumulativeOn(accountId: number, date: string): Promise<string | undefined> {
  const [row] = await db
    .select({ cumulative: accountBalanceHistory.cumulativeBalance })
    .from(accountBalanceHistory)
    .where(and(eq(accountBalanceHistory.accountId, accountId), eq(accountBalanceHistory.balanceDate, date)));
  return row?.cumulative;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (createdAccountIds.length === 0) return;
  await db.delete(transactions).where(inArray(transactions.accountId, createdAccountIds));
  await db.delete(accountBalanceHistory).where(inArray(accountBalanceHistory.accountId, createdAccountIds));
  await db.delete(accounts).where(inArray(accounts.accountId, createdAccountIds));
  createdAccountIds.length = 0;
});

describe("rebuild lock (Issue #463)", () => {
  it("serializes two concurrent rebuilds of one account, so both writers' rows count", async () => {
    const accountId = await createAccount("Rebuild lock: race");
    const holdFirst = gate();
    const firstRebuilt = gate();

    // A inserts +100 and rebuilds, then holds its transaction open.
    const first = db.transaction(async (tx) => {
      await tx.insert(transactions).values(insertRow(accountId, "100.00"));
      await rebuildAccountBalance(tx, accountId);
      firstRebuilt.open();
      await holdFirst.wait;
    });
    await firstRebuilt.wait;

    // B inserts +50 and rebuilds while A is uncommitted. Without the lock its
    // rebuild would sum from a snapshot without A's row, then overwrite A's
    // totals once A committed: a balance of 50, with no error anywhere.
    const second = db.transaction(async (tx) => {
      await tx.insert(transactions).values(insertRow(accountId, "50.00"));
      await rebuildAccountBalance(tx, accountId);
    });
    let lockWaiters: number;
    try {
      await waitForBlockedSessions(1);
      lockWaiters = await rebuildLockWaiters();
    } finally {
      holdFirst.open();
      await Promise.allSettled([first, second]);
    }
    await Promise.all([first, second]);

    const today = (await db.execute<{ d: string }>(sql`SELECT CURRENT_DATE::text AS d`)).rows[0].d;
    expect(await cumulativeOn(accountId, today)).toBe("150.00");
    // …because B waited on the rebuild lock before it summed anything.
    expect(lockWaiters!).toBe(1);
  });

  it("times out loudly when the lock is held, and writes nothing", async () => {
    const accountId = await createAccount("Rebuild lock: timeout");
    const holdFirst = gate();
    const holderLocked = gate();

    const holder = db.transaction(async (tx) => {
      await lockAccountBalance(tx, accountId);
      holderLocked.open();
      await holdFirst.wait;
    });
    await holderLocked.wait;

    const blocked = db.transaction(async (tx) => {
      await tx.insert(transactions).values(insertRow(accountId, "75.00"));
      await rebuildAccountBalance(tx, accountId, { lockTimeout: "300ms" });
    });

    const error = await blocked
      .then(
        () => null,
        (e: unknown) => e
      )
      .finally(() => holdFirst.open());
    await holder;

    expect(error).toBeInstanceOf(BalanceRebuildLockTimeoutError);
    expect(error).toMatchObject({ code: "55P03", accountId, timeout: "300ms" });
    expect((error as Error).message).toMatch(/Nothing was written/);
    // The driver's own error is kept as the cause, with its SQLSTATE.
    expect((error as Error).cause).toMatchObject({ code: "55P03" });

    // The insert rolled back with the rest of the transaction.
    const rows = await db.select().from(transactions).where(eq(transactions.accountId, accountId));
    expect(rows).toHaveLength(0);
  });

  it("is reported with its SQLSTATE, not swallowed", async () => {
    const accountId = await createAccount("Rebuild lock: report");
    const holdFirst = gate();
    const holderLocked = gate();
    const holder = db.transaction(async (tx) => {
      await lockAccountBalance(tx, accountId);
      holderLocked.open();
      await holdFirst.wait;
    });
    await holderLocked.wait;

    const error = await db
      .transaction((tx) => rebuildAccountBalance(tx, accountId, { lockTimeout: "200ms" }))
      .then(
        () => null,
        (e: unknown) => e
      )
      .finally(() => holdFirst.open());
    await holder;

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(error, { action: "submitTransaction" });
    const record = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(record.err).toMatchObject({ name: "BalanceRebuildLockTimeoutError", code: "55P03" });
    expect(record.err.cause).toMatchObject({ code: "55P03" });
  });

  it("restores lock_timeout after taking the lock", async () => {
    const accountId = await createAccount("Rebuild lock: restore");
    const after = await db.transaction(async (tx) => {
      await lockAccountBalance(tx, accountId, { lockTimeout: "123ms" });
      return (await tx.execute<{ t: string }>(sql`SELECT current_setting('lock_timeout') AS t`)).rows[0].t;
    });
    const sessionDefault = (await db.execute<{ t: string }>(sql`SELECT current_setting('lock_timeout') AS t`)).rows[0].t;
    expect(after).toBe(sessionDefault);
  });

  it("takes several accounts' locks in ascending order, so crossed writers can't deadlock", async () => {
    const low = await createAccount("Rebuild lock: low");
    const high = await createAccount("Rebuild lock: high");
    expect(low).toBeLessThan(high);
    const holdFirst = gate();
    const firstHasLow = gate();

    // A takes `low` and waits; later it will want `high`.
    const first = db.transaction(async (tx) => {
      await lockAccountBalance(tx, low);
      firstHasLow.open();
      await holdFirst.wait;
      await lockAccountBalance(tx, high);
    });
    await firstHasLow.wait;

    // B asks for [high, low]. Sorted, it waits on `low` first and holds nothing
    // on `high`, so A can still take `high`. Unsorted, B would hold `high` while
    // waiting on `low`, and A then waiting on `high` would deadlock (40P01).
    const second = db.transaction((tx) => rebuildAccountBalances(tx, [high, low, null, high]));
    try {
      await waitForBlockedSessions(1);
    } finally {
      holdFirst.open();
    }
    await expect(Promise.all([first, second])).resolves.toBeDefined();
  });
});
