import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in — Finance Stack",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  // The proxy appends ?callbackUrl=<original path> when it bounces an
  // unauthenticated request here; return the user there after sign-in.
  // Auth.js only follows same-origin redirect targets.
  const { callbackUrl } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <LoginForm redirectTo={callbackUrl ?? "/dashboard"} />
    </main>
  );
}
