"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report";

/**
 * Last-resort boundary (Issue #129). `app/(app)/error.tsx` sits *inside* the
 * root layout and so cannot catch a throw from the layout itself, from
 * `globals.css` failing to load, or from the theme provider — before this
 * existed those rendered Next's built-in fallback and were recorded nowhere.
 *
 * It replaces the root layout when it renders, which is why it declares its
 * own <html>/<body> and uses inline styles: none of the app's providers, fonts
 * or Tailwind layers are guaranteed to have loaded at this point, and a
 * boundary that depends on the thing that just failed is not a boundary.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // No usePathname() here — the router context is part of what may have failed.
  useEffect(() => {
    reportError(error, { route: "global-error", digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem",
          margin: 0,
        }}
      >
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: "0.875rem", opacity: 0.7, margin: 0 }}>
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={reset}
          style={{
            borderRadius: "0.375rem",
            border: "1px solid currentColor",
            background: "transparent",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
