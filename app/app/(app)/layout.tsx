import { redirect } from "next/navigation";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/auth/roles";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Authoritative page-level gate: the proxy (app/proxy.ts) already redirects
  // unauthenticated requests, but proxy interception can be bypassed, so every
  // (app) page re-verifies the session here, next to the data it renders.
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Nav rendering only (Issue #87), which is why the token's claim is good
  // enough here: showing a link a stale cookie should not show costs nothing,
  // because /settings/admin re-reads the role from the database and 404s.
  const isAdmin = isAdminRole(session.user.role);

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar isAdmin={isAdmin} />
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </header>
          <main className="flex-1">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
