import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { captureEvent, __resetErrorTracking } from "@/lib/error-tracking";

/**
 * The transport half of Issue #232. What this file does NOT test is whether the
 * payload is redacted — that is asserted where the redaction lives, in
 * tests/unit/lib/report.test.ts and tests/integration/actions/logging.test.ts,
 * against the request body. captureEvent() cannot redact anything: it is handed
 * serializeError()'s output and never sees a raw error.
 */

const DSN = "http://publickey123@glitchtip:8000/1";

// Shaped like serializeError() output for a wrapped driver error.
const SERIALIZED = {
  name: "Error",
  message: 'Failed query: insert into "accounts" ("account_name") values ($1)',
  stack: "Error: Failed query\n    at createAccount (lib/actions/account.ts:42:5)",
  cause: { name: "error", message: "insert or update violates foreign key", code: "23503" },
};

let fetchMock: ReturnType<typeof vi.fn>;

/** Only Date is faked, so real microtasks and timers still run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function ok() {
  return Promise.resolve({ ok: true, status: 200 });
}

beforeEach(() => {
  __resetErrorTracking();
  fetchMock = vi.fn(ok);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ERROR_DSN", DSN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function sent(call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  const lines = (init.body as string).split("\n");
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    envelopeHeader: JSON.parse(lines[0]) as Record<string, string>,
    itemHeader: JSON.parse(lines[1]) as Record<string, string>,
    event: JSON.parse(lines[2]) as Record<string, never>,
  };
}

describe("DSN handling", () => {
  it("does nothing at all when ERROR_DSN is unset", () => {
    vi.stubEnv("ERROR_DSN", "");

    captureEvent(SERIALIZED);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("derives the envelope endpoint from the DSN", () => {
    captureEvent(SERIALIZED);

    expect(sent().url).toBe("http://glitchtip:8000/api/1/envelope/");
  });

  it("keeps a path prefix, for an instance served under a subdirectory", () => {
    // Dropping this is the subtle way to post into the void: the request still
    // goes somewhere, it just is not the ingest endpoint.
    vi.stubEnv("ERROR_DSN", "https://key@example.com/errors/tracking/42");

    captureEvent(SERIALIZED);

    expect(sent().url).toBe("https://example.com/errors/tracking/api/42/envelope/");
  });

  it("sends the public key in the auth header", () => {
    captureEvent(SERIALIZED);

    const auth = sent().headers["X-Sentry-Auth"];
    expect(auth).toContain("sentry_version=7");
    expect(auth).toContain("sentry_key=publickey123");
    expect(auth).toContain("sentry_client=finance-stack/");
  });

  it.each([
    ["not a URL at all", "nonsense"],
    ["no public key", "http://glitchtip:8000/1"],
    ["no project id", "http://key@glitchtip:8000/"],
    ["empty string", ""],
  ])("treats a malformed DSN (%s) as unconfigured rather than throwing", (_label, dsn) => {
    vi.stubEnv("ERROR_DSN", dsn);

    expect(() => captureEvent(SERIALIZED)).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("envelope format", () => {
  it("posts three newline-delimited parts with a matching event_id", () => {
    captureEvent(SERIALIZED);

    const { init, envelopeHeader, itemHeader, event } = sent();
    expect(init.method).toBe("POST");
    expect(itemHeader.type).toBe("event");
    expect(envelopeHeader.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(event.event_id).toBe(envelopeHeader.event_id);
  });

  it("declares the envelope content type", () => {
    captureEvent(SERIALIZED);

    expect(sent().headers["Content-Type"]).toBe("application/x-sentry-envelope");
  });

  it("maps name and message onto the exception interface", () => {
    captureEvent(SERIALIZED);

    const values = sent().event.exception as unknown as { values: { type: string; value: string }[] };
    expect(values.values[0].type).toBe("Error");
    expect(values.values[0].value).toContain("Failed query");
  });

  it("carries the remaining serialized fields in extra, stack included", () => {
    captureEvent(SERIALIZED);

    const extra = sent().event.extra as unknown as Record<string, unknown>;
    expect(extra.stack).toContain("createAccount");
    expect((extra.cause as Record<string, unknown>).code).toBe("23503");
    // Already on the exception interface — not duplicated here.
    expect(extra.name).toBeUndefined();
    expect(extra.message).toBeUndefined();
  });

  it("indexes route, action and digest as tags, and the actor as the user", () => {
    captureEvent(SERIALIZED, {
      route: "/dashboard/accounts",
      action: "createAccount",
      digest: "4255873193",
      user_id: "abc",
    });

    const event = sent().event as unknown as Record<string, Record<string, string>>;
    expect(event.tags).toMatchObject({
      route: "/dashboard/accounts",
      action: "createAccount",
      digest: "4255873193",
    });
    expect(event.user.id).toBe("abc");
    expect(event.transaction).toBe("/dashboard/accounts");
  });

  it("keeps any other context field queryable in extra", () => {
    captureEvent(SERIALIZED, { method: "POST", path: "/api/health", route_type: "render" });

    const extra = sent().event.extra as unknown as Record<string, unknown>;
    expect(extra.method).toBe("POST");
    expect(extra.path).toBe("/api/health");
    expect(extra.route_type).toBe("render");
  });

  it("omits the user entirely when the call site could not resolve one", () => {
    captureEvent(SERIALIZED);

    expect(sent().event).not.toHaveProperty("user");
  });
});

describe("failure handling", () => {
  it("swallows a rejected fetch — the error path must not throw", async () => {
    fetchMock.mockReturnValue(Promise.reject(new Error("ECONNREFUSED")));

    expect(() => captureEvent(SERIALIZED)).not.toThrow();
    await flush();
  });

  it("swallows a fetch that throws synchronously", () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError("bad request");
    });

    expect(() => captureEvent(SERIALIZED)).not.toThrow();
  });

  it("survives a fetch stubbed to return a non-promise", () => {
    fetchMock.mockReturnValue(undefined as never);

    expect(() => captureEvent(SERIALIZED)).not.toThrow();
  });

  it("stops sending once the backend has failed repeatedly", async () => {
    fetchMock.mockReturnValue(Promise.reject(new Error("ECONNREFUSED")));

    for (let i = 0; i < 6; i += 1) {
      captureEvent(SERIALIZED);
      await flush();
    }

    // Five attempts open the breaker; the sixth is not sent.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("counts a non-2xx response as a failure, not a delivery", async () => {
    // A wrong key or a deleted project would otherwise look like success forever.
    fetchMock.mockReturnValue(Promise.resolve({ ok: false, status: 401 }));

    for (let i = 0; i < 6; i += 1) {
      captureEvent(SERIALIZED);
      await flush();
    }

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("retries again once the cooldown has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fetchMock.mockReturnValue(Promise.reject(new Error("ECONNREFUSED")));

    for (let i = 0; i < 6; i += 1) {
      captureEvent(SERIALIZED);
      await flush();
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);

    vi.setSystemTime(Date.now() + 61_000);
    captureEvent(SERIALIZED);

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("recovers the counter after a success", async () => {
    fetchMock.mockReturnValueOnce(Promise.reject(new Error("ECONNREFUSED")));
    captureEvent(SERIALIZED);
    await flush();

    fetchMock.mockReturnValue(ok());
    for (let i = 0; i < 6; i += 1) {
      captureEvent(SERIALIZED);
      await flush();
    }

    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
});
