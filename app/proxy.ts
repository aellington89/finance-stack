// Next.js 16 proxy (the renamed middleware.ts, Node.js runtime): first line
// of defense — redirects unauthenticated requests on protected paths to
// /login via the `authorized` callback in auth.ts. Not the security
// boundary on its own: the (app) layout re-checks auth() and every server
// action is gated by requireActionUser().
export { auth as proxy } from "@/auth";

export const config = {
  // Protected page trees only. Deliberately excluded: "/" (public landing),
  // "/login", "/api/auth/*" (NextAuth's own routes), "/api/health" (polled
  // unauthenticated by the Docker healthcheck and the release smoke test),
  // and Next.js static assets.
  //
  // "/api/health/seed-data" is excluded on purpose too, but it is not public:
  // it gates itself with auth() and answers 401 (#191). Matching it here would
  // redirect a denied caller to /login, so a monitor would read a 200 HTML page
  // as success — the wrong answer for a JSON endpoint.
  matcher: [
    "/dashboard/:path*",
    "/accounts/:path*",
    "/settings/:path*",
    "/test-ui/:path*",
  ],
};
