import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Instrumentation } from "next";
import { onRequestError } from "@/instrumentation";

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => consoleError.mockClear());

function emitted(): string {
  expect(consoleError).toHaveBeenCalledOnce();
  return consoleError.mock.calls[0][0] as string;
}

function parsed() {
  return JSON.parse(emitted()) as Record<string, never>;
}

type Request = Parameters<Instrumentation.onRequestError>[1];
type Context = Parameters<Instrumentation.onRequestError>[2];

function request(overrides: Partial<Request> = {}): Request {
  return {
    path: "/dashboard/accounts",
    method: "GET",
    headers: { "user-agent": "vitest" },
    ...overrides,
  };
}

function context(overrides: Partial<Context> = {}): Context {
  return {
    routerKind: "App Router",
    routePath: "/dashboard/accounts",
    routeType: "render",
    revalidateReason: undefined,
    ...overrides,
  };
}

describe("onRequestError", () => {
  it("reports a Server Component render failure with its route", () => {
    onRequestError(new Error("query blew up"), request(), context());

    const record = parsed();
    expect(record.level).toBe("error");
    expect(record.route).toBe("/dashboard/accounts");
    expect(record.route_type).toBe("render");
    expect(record.method).toBe("GET");
    expect((record.err as Record<string, unknown>).message).toBe("query blew up");
  });

  it("reports a server action that throws", () => {
    // app-render sets routeType: 'action' when the request is a server action,
    // which is what makes this hook cover the mutation surface too — the
    // failures lib/actions/failure.ts never sees because they escape the try.
    onRequestError(
      new Error("unexpected"),
      request({ path: "/accounts/new", method: "POST" }),
      context({ routePath: "/accounts/new", routeType: "action" })
    );

    const record = parsed();
    expect(record.route_type).toBe("action");
    expect(record.method).toBe("POST");
    expect(record.msg).toBe("Unhandled error in /accounts/new");
  });

  it("reports a route handler failure", () => {
    onRequestError(
      new Error("db down"),
      request({ path: "/api/health" }),
      context({ routePath: "/api/health", routeType: "route" })
    );

    expect(parsed().route_type).toBe("route");
  });

  it("carries renderSource when Next supplies one", () => {
    onRequestError(
      new Error("rsc"),
      request(),
      context({ renderSource: "react-server-components" })
    );

    expect(parsed().render_source).toBe("react-server-components");
  });

  it("never logs request headers", () => {
    // Headers carry the Auth.js session cookie. This is the reason the hook
    // takes only path and method off the request.
    onRequestError(
      new Error("boom"),
      request({
        headers: {
          cookie: "authjs.session-token=SUPERSECRETVALUE",
          authorization: "Bearer ANOTHERSECRET",
        },
      }),
      context()
    );

    const line = emitted();
    expect(line).not.toContain("SUPERSECRETVALUE");
    expect(line).not.toContain("ANOTHERSECRET");
    expect(line).not.toContain("authjs.session-token");
    expect(parsed()).not.toHaveProperty("headers");
  });

  it("carries the digest React attached, which is the join key to the browser record", () => {
    // Verified live against a real Server Component throw: the digest emitted
    // here matches the one Next prints and the one error.tsx receives.
    onRequestError(
      Object.assign(new Error("render blew up"), { digest: "4255873193" }),
      request(),
      context({ renderSource: "react-server-components" })
    );

    expect(parsed().digest).toBe("4255873193");
  });

  it("emits a single line", () => {
    onRequestError(new Error("multi\nline"), request(), context());
    expect(emitted()).not.toContain("\n");
  });

  it("does not throw when Next hands it a non-Error", () => {
    // `error` is typed `unknown` for a reason — a rejected promise can carry
    // anything, and this hook runs while Next is already rendering an error.
    expect(() => onRequestError("string throw", request(), context())).not.toThrow();
    expect(parsed().level).toBe("error");
  });
});
