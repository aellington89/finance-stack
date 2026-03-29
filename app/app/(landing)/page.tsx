// Root page — entry point for the application.
// Displays a simple landing with a link to the dashboard.

import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <h1 className="text-4xl font-bold">Finance Stack</h1>
      <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
        Personal finance data warehouse
      </p>
      <Link
        href="/dashboard"
        className="mt-8 rounded-full bg-foreground px-6 py-3 text-background transition-colors hover:bg-zinc-700 dark:hover:bg-zinc-300"
      >
        Go to Dashboard
      </Link>
    </main>
  );
}
