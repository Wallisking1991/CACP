import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { connectorVersion } from "./build-config.js";

export default defineConfig({
  plugins: [react()],
  define: {
    __CONNECTOR_VERSION__: JSON.stringify(connectorVersion)
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["test/setup.ts"],
  },
});
