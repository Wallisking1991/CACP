import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "../../coverage/cli-adapter",
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 63,
        branches: 65,
        functions: 80,
        statements: 63,
        "src/{agent-compatibility,connector/attachment-materializer}.ts": {
          lines: 90,
          branches: 80,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
});
