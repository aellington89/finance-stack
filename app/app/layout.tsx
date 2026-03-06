// Root layout — wraps every page in the application.
// Global navigation sidebar will be added here once the base
// UI components are installed (Issue #20).

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance Stack",
  description: "Personal finance data warehouse",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
