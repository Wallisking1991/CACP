import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "../../coverage/server",
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 75,
        branches: 65,
        functions: 75,
        statements: 75,
        "src/attachment-{policy,store}.ts": {
          lines: 90,
          branches: 80,
          functions: 90,
          statements: 90,
        },
        "src/auth.ts": {
          lines: 90,
          branches: 80,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
});
