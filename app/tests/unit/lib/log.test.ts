import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "@/lib/log";

const spies = {
  log: vi.spyOn(console, "log").mockImplementation(() => {}),
  warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
};

const originalLevel = process.env.LOG_LEVEL;

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear();
  delete process.env.LOG_LEVEL;
});

afterEach(() => {
  if (originalLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalLevel;
});

/** The raw string handed to console — the thing an operator's `jq` receives. */
function emitted(spy: (typeof spies)[keyof typeof spies]): string {
  expect(spy).toHaveBeenCalledOnce();
  return spy.mock.calls[0][0] as string;
}

function parsed(spy: (typeof spies)[keyof typeof spies]) {
  return JSON.parse(emitted(spy)) as Record<string, unknown>;
}

describe("log record shape", () => {
  it("emits parseable JSON carrying ts, level and msg", () => {
    log.error("something broke");

    const record = parsed(spies.error);
    expect(record.level).toBe("error");
    expect(record.msg).toBe("something broke");
    // Parses as a real timestamp rather than just being present.
    expect(Date.parse(record.ts as string)).not.toBeNaN();
  });

  it("merges caller fields to the top level", () => {
    log.error("createAccount failed", {
      route: "/accounts/new",
      action: "createAccount",
      user_id: "11111111-2222-3333-4444-555555555555",
    });

    expect(parsed(spies.error)).toMatchObject({
      route: "/accounts/new",
      action: "createAccount",
      user_id: "11111111-2222-3333-4444-555555555555",
    });
  });

  it("drops undefined fields rather than emitting nulls", () => {
    // Makes `{ user_id: session?.user?.id }` safe at a call site.
    log.error("no session", { action: "createAccount", user_id: undefined });

    const record = parsed(spies.error);
    expect(record).not.toHaveProperty("user_id");
    expect(record.action).toBe("createAccount");
  });

  it("does not let a caller field overwrite ts, level or msg", () => {
    log.error("real message", { level: "debug", msg: "spoofed", ts: "nope" });

    const record = parsed(spies.error);
    expect(record.level).toBe("error");
    expect(record.msg).toBe("real message");
    expect(record.ts).not.toBe("nope");
  });
});

describe("single-line output", () => {
  // The acceptance criterion: one record is one line, so `docker compose logs
  // | jq` works without a multi-line parser.
  it("escapes a multi-line stack rather than breaking the line", () => {
    const stack = "Error: boom\n    at one (a.ts:1:1)\n    at two (b.ts:2:2)";

    log.error("failed", { err: { stack } });

    const line = emitted(spies.error);
    expect(line).not.toContain("\n");
    // The newlines survive as escapes, so the stack is still readable.
    expect(JSON.parse(line).err.stack).toBe(stack);
  });

  it("keeps a message containing newlines on one line", () => {
    log.error("line one\nline two");

    const line = emitted(spies.error);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line).msg).toBe("line one\nline two");
  });
});

describe("level routing", () => {
  it("sends error to stderr via console.error", () => {
    log.error("e");
    expect(spies.error).toHaveBeenCalledOnce();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.log).not.toHaveBeenCalled();
  });

  it("sends warn to console.warn", () => {
    log.warn("w");
    expect(spies.warn).toHaveBeenCalledOnce();
    expect(spies.error).not.toHaveBeenCalled();
  });

  it("sends info to stdout via console.log", () => {
    log.info("i");
    expect(spies.log).toHaveBeenCalledOnce();
    expect(parsed(spies.log).level).toBe("info");
  });
});

describe("LOG_LEVEL gate", () => {
  it("suppresses debug at the default level", () => {
    log.debug("noisy");
    expect(spies.log).not.toHaveBeenCalled();

    log.info("kept");
    expect(spies.log).toHaveBeenCalledOnce();
  });

  it("suppresses info and debug at LOG_LEVEL=warn", () => {
    process.env.LOG_LEVEL = "warn";

    log.debug("d");
    log.info("i");
    expect(spies.log).not.toHaveBeenCalled();

    log.warn("w");
    expect(spies.warn).toHaveBeenCalledOnce();
  });

  it("still emits errors at LOG_LEVEL=error", () => {
    process.env.LOG_LEVEL = "error";

    log.warn("w");
    expect(spies.warn).not.toHaveBeenCalled();

    log.error("e");
    expect(spies.error).toHaveBeenCalledOnce();
  });

  it("admits debug at LOG_LEVEL=debug", () => {
    process.env.LOG_LEVEL = "debug";

    log.debug("d");
    expect(spies.log).toHaveBeenCalledOnce();
  });

  it("falls back to info on an unrecognized value rather than throwing", () => {
    process.env.LOG_LEVEL = "verbose";

    log.debug("d");
    expect(spies.log).not.toHaveBeenCalled();

    log.info("i");
    expect(spies.log).toHaveBeenCalledOnce();
  });
});

describe("hostile payloads", () => {
  it("survives a circular reference", () => {
    const cyclic: Record<string, unknown> = { name: "pool" };
    cyclic.self = cyclic;

    expect(() => log.error("cyclic", { client: cyclic })).not.toThrow();

    const record = parsed(spies.error);
    expect((record.client as Record<string, unknown>).self).toBe("[Circular]");
    expect((record.client as Record<string, unknown>).name).toBe("pool");
  });

  it("serializes a repeated (but acyclic) reference twice instead of calling it circular", () => {
    // A WeakSet-based cycle check would mislabel the second occurrence.
    const shared = { id: 7 };

    log.error("shared", { first: shared, second: shared });

    const record = parsed(spies.error);
    expect(record.first).toEqual({ id: 7 });
    expect(record.second).toEqual({ id: 7 });
  });

  it("stringifies BigInt instead of throwing", () => {
    // JSON.stringify throws a TypeError on BigInt. Written as BigInt(10)
    // rather than the 10n literal, which the ES2017 target rejects.
    expect(() => log.error("big", { rows: BigInt(10) })).not.toThrow();
    expect(parsed(spies.error).rows).toBe("10");
  });

  it("still emits a record when serialization fails outright", () => {
    // A throwing toJSON() defeats the replacer — the logger must degrade
    // rather than throw over the top of whatever error it was reporting.
    const hostile = {
      toJSON() {
        throw new Error("nope");
      },
    };

    expect(() => log.error("hostile", { hostile })).not.toThrow();

    const record = parsed(spies.error);
    expect(record.msg).toBe("hostile");
    expect(record.level).toBe("error");
    expect(record.log_error).toBe("nope");
  });
});
