import { describe, it, expect } from "vitest";
import { BUILD_INFO } from "@/lib/version";
import pkg from "@/package.json";

describe("BUILD_INFO", () => {
  it("reports the version from package.json", () => {
    expect(BUILD_INFO.version).toBe(pkg.version);
  });

  it("falls back to dev/empty when build-time env vars are unset", () => {
    // NEXT_PUBLIC_GIT_SHA / NEXT_PUBLIC_BUILD_TIME are not set in the test env.
    expect(BUILD_INFO.gitSha).toBe("dev");
    expect(BUILD_INFO.buildTime).toBe("");
  });
});
