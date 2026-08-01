"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { reportError } from "@/lib/report";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  // Runs in the browser, so this record lands in the browser console, not in
  // `docker logs`. That is the ceiling here, not an oversight: in production
  // React redacts a Server Component error before it crosses the wire, so
  // `error.message` is a generic string and `digest` is the only identifying
  // part. The real error is captured server-side by instrumentation.ts under
  // the same digest — see docs/observability.md for how to join the two.
  useEffect(() => {
    reportError(error, { route: pathname, digest: error.digest });
  }, [error, pathname]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground text-sm">
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
      >
        Try again
      </button>
    </div>
  );
}
