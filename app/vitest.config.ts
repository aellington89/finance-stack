import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/setup.ts"],
          setupFiles: ["tests/integration/vitest-setup.ts"],
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/**/*.ts", "app/**/*.tsx"],
      exclude: [
        "**/*.test.ts",
        "app/(app)/test-ui/**",
        "drizzle/**",
      ],
    },
  },
});
