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
  matcher: [
    "/dashboard/:path*",
    "/accounts/:path*",
    "/settings/:path*",
    "/test-ui/:path*",
  ],
};
