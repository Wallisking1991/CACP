import { defineConfig } from "vitest/config";
import { connectorVersion } from "./build-config.js";

export default defineConfig({
  define: {
    __CONNECTOR_VERSION__: JSON.stringify(connectorVersion),
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "../../coverage/web",
      include: ["src/**/*.{ts,tsx}"],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 60,
        statements: 70,
        "src/attachment-api.ts": {
          lines: 90,
          branches: 80,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
});
