import { describe, it, expect, vi, type Mock } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";

import { auth } from "@/auth";
import AppLayout from "@/app/(app)/layout";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

// The real modules reach next-auth and the database. The layout only reads the
// session's role, and the sidebar only hands Sign out's form an action.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/actions/auth", () => ({ signOutAction: vi.fn() }));

const mockedAuth = auth as unknown as Mock;

function renderSidebar(isAdmin = false) {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar isAdmin={isAdmin} />
      </SidebarProvider>
    </TooltipProvider>
  );
}

// Issue #358: the (app) shell is what every logged-in page shares, so its
// landmarks are what axe reported on every page — two <main>s, and a sidebar
// that sat outside any landmark at all.
describe("AppLayout landmarks", () => {
  it("renders exactly one main landmark, around the page", async () => {
    mockedAuth.mockResolvedValue({ user: { role: "user" } });
    render(await AppLayout({ children: <p>Page body</p> }));

    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(within(mains[0]).getByText("Page body")).toBeInTheDocument();
  });

  it("puts the sidebar in a navigation landmark, outside main", async () => {
    mockedAuth.mockResolvedValue({ user: { role: "user" } });
    render(await AppLayout({ children: <p>Page body</p> }));

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(screen.getByRole("main")).not.toContainElement(nav);
  });
});

describe("AppSidebar", () => {
  it("holds the title, every link, Sign out and the version inside the nav", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation", { name: "Main" });

    expect(within(nav).getByText("Finance Stack")).toBeInTheDocument();
    for (const name of ["Dashboard", "Accounts", "Settings", "About"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: /^v\d/ })
    ).toHaveAttribute("href", "/settings/about");
  });

  it("offers Admin only to an admin", () => {
    const { unmount } = renderSidebar(false);
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    unmount();

    renderSidebar(true);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute(
      "href",
      "/settings/admin"
    );
  });

  it("marks the current section's link active", () => {
    vi.mocked(usePathname).mockReturnValue("/dashboard/liabilities");
    renderSidebar();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "data-active"
    );
    expect(screen.getByRole("link", { name: "Accounts" })).not.toHaveAttribute(
      "data-active"
    );
  });
});
