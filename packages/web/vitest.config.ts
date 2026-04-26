import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["test/setup.ts"],
  },
});
