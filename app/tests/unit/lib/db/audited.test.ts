import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// Mocked before the import under test, so auditedTransaction closes over these.
const execute = vi.fn();
const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({ execute })
);

vi.mock("@/lib/db", () => ({ db: { transaction } }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const { auditedTransaction } = await import("@/lib/db/audited");
const { auth } = await import("@/auth");
const mockedAuth = auth as unknown as Mock;

// Render the SQL template the way the real driver would, rather than reading
// drizzle's internal chunk list.
const dialect = new PgDialect();

function renderedQuery(): { sql: string; params: unknown[] } {
  expect(execute).toHaveBeenCalledOnce();
  return dialect.sqlToQuery(execute.mock.calls[0][0]);
}

beforeEach(() => {
  execute.mockClear();
  transaction.mockClear();
  mockedAuth.mockReset();
});

describe("auditedTransaction", () => {
  it("names the signed-in actor before running the callback", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "11111111-2222-3333-4444-555555555555", name: "ada" },
    });

    const order: string[] = [];
    execute.mockImplementation(async () => {
      order.push("set_config");
    });

    await auditedTransaction(async () => {
      order.push("callback");
    });

    // The actor must be set first, or the trigger fires without it.
    expect(order).toEqual(["set_config", "callback"]);
    expect(renderedQuery().params).toEqual([
      "11111111-2222-3333-4444-555555555555",
      "ada",
    ]);
  });

  it("scopes both settings to the transaction", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "abc", name: "ada" } });

    await auditedTransaction(async () => undefined);

    // `true` is the is_local argument. Without it the setting outlives the
    // request on a pooled connection and mis-attributes the next user's writes.
    // Matched loosely on whitespace — the assertion is about the is_local
    // argument, not about how the template happens to be indented.
    const sql = renderedQuery().sql.replace(/\s+/g, " ");
    expect(sql).toContain("set_config('app.actor_user_id', $1, true)");
    expect(sql).toContain("set_config('app.actor_label', $2, true)");
  });

  it("passes empty strings when there is no session", async () => {
    mockedAuth.mockResolvedValue(null);

    await auditedTransaction(async () => undefined);

    // The trigger reads these through nullif(..., ''), so empty means "no app
    // actor" and the row is attributed to the database role instead.
    expect(renderedQuery().params).toEqual(["", ""]);
  });

  it("returns the callback's value", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "abc", name: "ada" } });
    await expect(auditedTransaction(async () => 42)).resolves.toBe(42);
  });

  it("propagates a callback failure so the transaction rolls back", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "abc", name: "ada" } });
    await expect(
      auditedTransaction(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});
