import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8790",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node dist/server/main.js",
      url: "http://127.0.0.1:8790/health",
      reuseExistingServer: false,
      env: {
        PORT: "8790",
        DEMO_DATA_FILE: "test-results/e2e-demo.json",
        STORAGE_MODE: "demo",
        ALLOWED_HOSTS: "localhost,127.0.0.1,[::1]",
        ALLOWED_ORIGINS: "",
      },
    },
    {
      command: "npx tsx tests/fixtures/sheets-server.ts",
      url: "http://127.0.0.1:8791/health",
      reuseExistingServer: false,
    },
    {
      // Arnold schema v1 mode: 8792 with history, 8793 empty, 8794 failing,
      // 8795 writable workout logger, 8796 plan editor, 8797 plan first run,
      // 8798/8799 plan activation and conflict, 8800-8802 onboarding.
      command: "npx tsx tests/fixtures/arnold-server.ts",
      url: "http://127.0.0.1:8792/health",
      reuseExistingServer: false,
    },
  ],
});
