import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8890",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node dist/server/main.js",
      url: "http://127.0.0.1:8890/health",
      reuseExistingServer: false,
      env: {
        PORT: "8890",
        DEMO_DATA_FILE: "test-results/e2e-demo.json",
        STORAGE_MODE: "demo",
        ALLOWED_HOSTS: "localhost,127.0.0.1,[::1]",
        ALLOWED_ORIGINS: "",
      },
    },
    {
      command: "npx tsx tests/fixtures/sheets-server.ts",
      url: "http://127.0.0.1:8891/health",
      reuseExistingServer: false,
    },
    {
      // Arnold schema v1 mode: 8892 with history, 8893 empty, 8894 failing,
      // 8895 writable workout logger, 8896 plan editor, 8897 plan first run.
      command: "npx tsx tests/fixtures/arnold-server.ts",
      url: "http://127.0.0.1:8892/health",
      reuseExistingServer: false,
    },
  ],
});
