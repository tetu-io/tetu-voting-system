import { defineConfig } from "@playwright/test";

const runE2E = process.env.RUN_E2E === "1";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  testIgnore: runE2E ? [] : ["**/*"],
  retries: runE2E ? 1 : 0,
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: "http://127.0.0.1:4173"
  },
  webServer: runE2E
    ? {
        command: "cd ../.. && npm run dev:stack:e2e",
        port: 4173,
        reuseExistingServer: false,
        timeout: 240000
      }
    : undefined
});
