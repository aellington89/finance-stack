"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { LayoutDashboardIcon, LandmarkIcon, SettingsIcon, InfoIcon, LogOutIcon, ShieldIcon } from "lucide-react";
import { VersionBadge } from "@/components/version-badge";
import { signOutAction } from "@/lib/actions/auth";

const navItems = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboardIcon,
  },
  {
    title: "Accounts",
    href: "/accounts",
    icon: LandmarkIcon,
  },
  {
    title: "Settings",
    href: "/settings/categories",
    icon: SettingsIcon,
  },
  {
    title: "Admin",
    href: "/settings/admin",
    icon: ShieldIcon,
    // Rendered only for admins (Issue #87). This is UX, not enforcement — the
    // page notFound()s a non-admin and every action behind it re-checks the
    // role against the database.
    adminOnly: true,
  },
  {
    title: "About",
    href: "/settings/about",
    icon: InfoIcon,
  },
];

export function AppSidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <span className="text-lg font-bold">Finance Stack</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive =
                  item.href === "/dashboard"
                    ? pathname.startsWith("/dashboard")
                    : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <form action={signOutAction}>
              <SidebarMenuButton type="submit">
                <LogOutIcon />
                <span>Sign out</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="px-2 py-1 group-data-[state=collapsed]:hidden">
          <VersionBadge />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
