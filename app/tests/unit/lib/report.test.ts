import { describe, it, expect, vi, beforeEach } from "vitest";
import { reportError } from "@/lib/report";

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => consoleError.mockClear());

function emitted(): string {
  expect(consoleError).toHaveBeenCalledOnce();
  return consoleError.mock.calls[0][0] as string;
}

function parsed() {
  return JSON.parse(emitted()) as Record<string, never>;
}

/**
 * Shaped like a pg DatabaseError: a real Error with the driver's extra fields
 * assigned onto it. `detail` carries the values that must not reach the log.
 */
function databaseError(): Error {
  return Object.assign(
    new Error(
      'duplicate key value violates unique constraint "accounts_account_name_key"'
    ),
    {
      name: "error",
      code: "23505",
      constraint: "accounts_account_name_key",
      table: "accounts",
      column: "account_name",
      schema: "public",
      detail: "Key (account_name)=(Joint Checking) already exists.",
      hint: "Pick a different account_name.",
      where: "PL/pgSQL function audit_row_change() line 12 at RAISE",
      internalQuery: "SELECT balance FROM accounts WHERE account_name = 'Joint Checking'",
      severity: "ERROR",
      file: "nbtinsert.c",
      line: "664",
      routine: "_bt_check_unique",
    }
  );
}

describe("error serialization", () => {
  it("captures name, message and stack off an Error", () => {
    // JSON.stringify(new Error()) is "{}" — Error has no enumerable own
    // properties, so these have to be copied across by hand.
    reportError(new Error("boom"));

    const err = parsed().err as Record<string, unknown>;
    expect(err.name).toBe("Error");
    expect(err.message).toBe("boom");
    expect(err.stack).toContain("boom");
  });

  it("serializes one level of cause, which is where drizzle puts a driver error", () => {
    const wrapped = new Error("Failed query", { cause: databaseError() });

    reportError(wrapped);

    const err = parsed().err as Record<string, Record<string, unknown>>;
    expect(err.message).toBe("Failed query");
    expect(err.cause.code).toBe("23505");
    expect(err.cause.detail).toBeUndefined();
  });
});

describe("pg field redaction", () => {
  it("keeps the fields that identify which rule was violated", () => {
    reportError(databaseError(), { action: "createAccount" });

    const err = parsed().err as Record<string, unknown>;
    expect(err.code).toBe("23505");
    expect(err.constraint).toBe("accounts_account_name_key");
    expect(err.table).toBe("accounts");
    expect(err.column).toBe("account_name");
    expect(err.schema).toBe("public");
  });

  it("drops the fields whose purpose is to echo row data", () => {
    reportError(databaseError());

    const err = parsed().err as Record<string, unknown>;
    expect(err.detail).toBeUndefined();
    expect(err.hint).toBeUndefined();
    expect(err.where).toBeUndefined();
    expect(err.internalQuery).toBeUndefined();
  });

  it("leaves no trace of the offending row value anywhere in the line", () => {
    // The assertion that actually matters: not just that `detail` is absent as
    // a key, but that the value it carried appears nowhere in the output.
    reportError(databaseError(), { action: "createAccount" });

    const line = emitted();
    expect(line).not.toContain("Joint Checking");
    expect(line).not.toContain("Pick a different");
    expect(line).not.toContain("audit_row_change");
  });

  it("is an allowlist — an unrecognized driver field is not copied", () => {
    // A future pg release adding a field must not start leaking by default.
    reportError(Object.assign(new Error("x"), { rowData: "sensitive" }));

    expect(emitted()).not.toContain("sensitive");
  });
});

describe("drizzle query-parameter redaction", () => {
  /**
   * Mirrors DrizzleQueryError (node_modules/drizzle-orm/errors.js): the message
   * is `Failed query: <sql>\nparams: <values>`, with `query` and `params` also
   * set as own properties. This is what every failed statement in this app
   * actually throws, so it is the shape that matters most.
   */
  function drizzleQueryError(): Error {
    const query =
      'insert into "transactions" ("transaction_description", "amount", "account_id") values ($1, $2, $3)';
    const params = ["Groceries at Whole Foods", "1284.55", "7"];
    const wrapper = new Error(`Failed query: ${query}\nparams: ${params}`);
    return Object.assign(wrapper, { query, params, cause: databaseError() });
  }

  it("strips the bound parameters from the message", () => {
    reportError(drizzleQueryError(), { action: "submitTransaction" });

    const err = parsed().err as Record<string, unknown>;
    expect(err.message).toContain("Failed query: insert into");
    expect(err.message).not.toContain("params:");
    expect(err.message).not.toContain("Groceries at Whole Foods");
  });

  it("keeps the parameterized SQL, which holds placeholders and not values", () => {
    reportError(drizzleQueryError());

    const err = parsed().err as Record<string, unknown>;
    expect(err.message).toContain("($1, $2, $3)");
  });

  it("rewrites the stack header, where the message is repeated verbatim", () => {
    // The easy way to "redact" a field and still ship it.
    reportError(drizzleQueryError());

    const err = parsed().err as Record<string, unknown>;
    expect(err.stack).not.toContain("Groceries at Whole Foods");
    expect(err.stack).not.toContain("1284.55");
  });

  it("does not copy the query/params own properties", () => {
    reportError(drizzleQueryError());

    const err = parsed().err as Record<string, unknown>;
    expect(err.params).toBeUndefined();
  });

  it("leaves no row value anywhere in the emitted line", () => {
    reportError(drizzleQueryError(), { action: "submitTransaction" });

    const line = emitted();
    expect(line).not.toContain("Groceries at Whole Foods");
    expect(line).not.toContain("1284.55");
    // The diagnosis still survives: SQLSTATE off the wrapped driver error.
    expect(line).toContain("23505");
  });

  it("truncates a very long message rather than flooding the line", () => {
    reportError(new Error("x".repeat(5000)));

    const message = (parsed().err as Record<string, unknown>).message as string;
    expect(message).toContain("[truncated]");
    expect(message.length).toBeLessThan(1100);
  });
});

describe("non-Error throws", () => {
  it.each([
    ["a string", "boom"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["an empty object", {}],
  ])("does not crash on %s", (_label, thrown) => {
    expect(() => reportError(thrown)).not.toThrow();
    expect(parsed().level).toBe("error");
  });

  it("describes a bare string throw", () => {
    reportError("boom");

    const err = parsed().err as Record<string, unknown>;
    expect(err.name).toBe("NonError");
    expect(err.message).toBe("boom");
  });

  it("reads name and message off a plain object that has them", () => {
    reportError({ name: "TimeoutError", message: "took too long" });

    const err = parsed().err as Record<string, unknown>;
    expect(err.name).toBe("TimeoutError");
    expect(err.message).toBe("took too long");
  });
});

describe("context", () => {
  it("lifts the digest off a server error so it can be joined to the browser record", () => {
    // React attaches `digest` as an own property and sends only that to the
    // client, holding the real message back. serializeError() copies through an
    // allowlist, so without this the server record has no join key and the
    // correlation documented in docs/observability.md does not work.
    const error = Object.assign(new Error("render blew up"), {
      digest: "4255873193",
    });

    reportError(error, { route: "/dashboard" });

    expect(parsed().digest).toBe("4255873193");
  });

  it("prefers an explicitly supplied digest over the one on the error", () => {
    // The client boundaries receive the digest as a prop and pass it in.
    const error = Object.assign(new Error("x"), { digest: "from-error" });

    reportError(error, { digest: "from-prop" });

    expect(parsed().digest).toBe("from-prop");
  });

  it("omits digest entirely when there is none", () => {
    reportError(new Error("plain"));

    expect(parsed()).not.toHaveProperty("digest");
  });

  it("ignores a non-string digest", () => {
    reportError(Object.assign(new Error("x"), { digest: 12345 }));

    expect(parsed()).not.toHaveProperty("digest");
  });

  it("passes route, action, user_id and digest through", () => {
    reportError(new Error("x"), {
      route: "/dashboard",
      action: "createAccount",
      user_id: "abc",
      digest: "3552847923",
    });

    expect(parsed()).toMatchObject({
      route: "/dashboard",
      action: "createAccount",
      user_id: "abc",
      digest: "3552847923",
    });
  });

  it("derives msg from the action when there is one", () => {
    reportError(new Error("x"), { action: "deleteTransaction" });
    expect(parsed().msg).toBe("deleteTransaction failed");
  });

  it("derives msg from the route when there is no action", () => {
    reportError(new Error("x"), { route: "/api/health" });
    expect(parsed().msg).toBe("Unhandled error in /api/health");
  });

  it("falls back to a generic msg with no context at all", () => {
    reportError(new Error("x"));
    expect(parsed().msg).toBe("Unhandled error");
  });
});
