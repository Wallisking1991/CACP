import { defineConfig, devices } from "@playwright/test";

const localBrowser = process.env.CI ? {} : { channel: "chrome" as const };

export default defineConfig({
  testDir: "./packages/web/test/e2e",
  testMatch: "whiteboard-collaboration.test.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...localBrowser },
    },
  ],
  webServer: [
    {
      command: "corepack pnpm dev:server",
      env: {
        CACP_DB: ":memory:",
        HOST: "127.0.0.1",
        PORT: "3737",
      },
      url: "http://127.0.0.1:3737/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "corepack pnpm --filter @cacp/protocol build && " +
        "corepack pnpm --filter @cacp/web exec vite " +
        "--host 127.0.0.1 --port 5174",
      url: "http://127.0.0.1:5174/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
