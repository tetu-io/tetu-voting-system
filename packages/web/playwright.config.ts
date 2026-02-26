import { defineConfig } from "@playwright/test";

const runE2E = process.env.RUN_E2E === "1";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  testIgnore: runE2E ? [] : ["**/*"],
  use: {
    baseURL: "http://127.0.0.1:4173"
  },
  webServer: runE2E
    ? {
        command: "npm run dev -- --host 127.0.0.1 --port 4173",
        port: 4173,
        reuseExistingServer: true,
        timeout: 120000
      }
    : undefined
});
