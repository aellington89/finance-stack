import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VersionBadge } from "@/components/version-badge";
import { BUILD_INFO } from "@/lib/version";

describe("VersionBadge", () => {
  it("renders the built version as a link to the about page", () => {
    render(<VersionBadge />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/settings/about");
    expect(link).toHaveTextContent(`v${BUILD_INFO.version}`);
  });

  it("marks an unstamped build as dev", () => {
    // NEXT_PUBLIC_GIT_SHA is unset under vitest, so BUILD_INFO.gitSha falls
    // back to "dev" — the badge must say so rather than show a 7-char slice
    // of the word.
    expect(BUILD_INFO.gitSha).toBe("dev");
    render(<VersionBadge />);
    expect(screen.getByRole("link")).toHaveTextContent("(dev)");
  });
});
