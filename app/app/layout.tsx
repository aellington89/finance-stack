import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Finance Stack",
  description: "Personal finance data warehouse",
};

/**
 * Reading headers() here opts **every** route into dynamic rendering, which is
 * required rather than incidental (#237). A prerendered page's inline
 * flight-data scripts are baked in at build time with no nonce, so serving one
 * under a nonce-bearing policy means it never hydrates. Before this, `/` and
 * `/_not-found` were the only prerendered routes left — the 14 dashboard pages
 * already export `force-dynamic` and `/login` awaits searchParams — so the cost
 * is two routes on a single-user self-hosted app.
 *
 * `next-themes` needs the nonce for both of the things it injects: the blocking
 * FOUC script that sets the theme class before first paint, and the transition
 * suppressor that `disableTransitionOnChange` adds on every theme switch. It
 * puts the nonce on the script server-side only, which is deliberate on its
 * part — the attribute is already in the DOM by the time the client re-renders.
 *
 * In development there is no nonce (proxy.ts mints none), so this reads
 * undefined and next-themes omits the attribute, which the dev policy's
 * 'unsafe-inline' covers.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
