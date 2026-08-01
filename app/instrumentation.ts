import type { Instrumentation } from "next";
import { reportError } from "@/lib/report";

/**
 * Server-side capture for errors that escape (Issue #129).
 *
 * Next calls this for any unhandled throw it renders an error page for: a
 * Server Component render, a route handler, the proxy, and a server action
 * that throws — `app-render.tsx` sets `routeType: 'action'` when the request
 * is a server action, so the action surface is covered here too.
 *
 * It is *not* redundant with `lib/actions/failure.ts`. Every action in
 * `lib/actions/` catches its own database errors and returns an `ActionState`
 * rather than throwing, so those never reach this hook; this is what catches
 * the failures nobody anticipated — a bug in validation, a null deref in a
 * query helper, a page that throws while rendering.
 *
 * This is also the only capture point that sees the *real* error for a Server
 * Component failure. React redacts the message before it crosses to the
 * client in production, so `app/(app)/error.tsx` only ever receives a digest.
 * Both records carry that digest, which is how the two are correlated.
 *
 * `request.headers` is deliberately not logged. It carries the Auth.js session
 * cookie, and an allowlist of "safe" headers is a thing to get wrong later —
 * the path and method are what actually help.
 *
 * See docs/observability.md.
 */
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context
) => {
  reportError(error, {
    route: context.routePath,
    route_type: context.routeType,
    render_source: context.renderSource,
    router_kind: context.routerKind,
    revalidate_reason: context.revalidateReason,
    method: request.method,
    path: request.path,
  });
};
