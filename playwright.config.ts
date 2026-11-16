import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "webkit",
      use: { browserName: "webkit" },
      testMatch: [
        "**/beta-cards.spec.ts",
        "**/onboarding.spec.ts",
        "**/onboarding-latency.spec.ts",
        "**/onboarding-run.spec.ts",
        "**/arnold-dashboard.spec.ts",
        "**/arnold-v2-qa.spec.ts",
        "**/run-cards.spec.ts",
        "**/home-run.spec.ts",
        "**/conversation-cards.spec.ts",
      ],
    },
  ],
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8792",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      // Arnold schema v1 mode: 8792 with history, 8793 empty, 8794 failing,
      // 8795 writable workout logger, 8796 plan editor, 8797 plan first run,
      // 8798/8799 plan activation and conflict, 8800-8803 onboarding,
      // 8804 start screen with invented history and goals, 8805 plan change
      // from the training card, 8806 setup with the starter catalog.
      command: "npx tsx tests/fixtures/arnold-server.ts",
      url: "http://127.0.0.1:8792/health",
      reuseExistingServer: false,
    },
  ],
});
