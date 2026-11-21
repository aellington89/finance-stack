import { describe, it, expect } from "vitest";
import {
  BalanceRebuildLockTimeoutError,
  sortedAccountIds,
} from "@/lib/queries/rebuild-balance";

// The DB-free half of the rebuild lock (Issue #463). The lock itself is
// exercised against Postgres in tests/integration/queries/rebuild-balance-lock.test.ts.

describe("sortedAccountIds", () => {
  it("dedupes, drops absent related accounts, and sorts ascending", () => {
    expect(sortedAccountIds([12, null, 3, undefined, 12, 7])).toEqual([3, 7, 12]);
  });

  it("sorts numerically, not lexically", () => {
    expect(sortedAccountIds([10, 9, 100])).toEqual([9, 10, 100]);
  });

  it("is empty for no accounts", () => {
    expect(sortedAccountIds([null])).toEqual([]);
  });
});

describe("BalanceRebuildLockTimeoutError", () => {
  it("carries the SQLSTATE, the account and the timeout, and says nothing was written", () => {
    const cause = Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
    const error = new BalanceRebuildLockTimeoutError(42, "15s", { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "BalanceRebuildLockTimeoutError", code: "55P03", accountId: 42, timeout: "15s" });
    expect(error.message).toBe(
      "Timed out after 15s waiting to rebuild balance history for account 42: another transaction held the account's rebuild lock. Nothing was written."
    );
    expect(error.cause).toBe(cause);
  });
});
