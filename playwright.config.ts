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
        "**/onboarding-voice.spec.ts",
        "**/arnold-dashboard.spec.ts",
        "**/arnold-v2-qa.spec.ts",
        "**/run-cards.spec.ts",
        "**/home-run.spec.ts",
        "**/home-card.spec.ts",
        "**/conversation-cards.spec.ts",
        "**/plan-change.spec.ts",
        "**/plan-adjustment.spec.ts",
        "**/recap.spec.ts",
      ],
    },
  ],
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8792",
    timezoneId: "Europe/Berlin",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      // Arnold schema v1 mode: 8792 with history, 8793 empty, 8794 failing,
      // 8795 writable workout logger, 8796 plan editor, 8797 plan first run,
      // 8798/8799 plan activation and conflict, 8800-8803 onboarding,
      // 8804 start screen with invented history and goals, 8830/8831 plan change card (UX-005), 8834/8835 adjustment for a while (UX-008), 8832/8833 recap (UX-006), 8805 plan change
      // from the training card, 8806 setup with the starter catalog.
      command: "npx tsx tests/fixtures/arnold-server.ts",
      url: "http://127.0.0.1:8792/health",
      reuseExistingServer: false,
      // These specs drive the former interface (src/ui) and name it.
      env: { ARNOLD_UI: "legacy" },
    },
    // DATE-001: the start screen on a clock shortly before and after midnight
    // UTC (22 Nov 23:30 and 23 Nov 00:30 UTC; Berlin is already or just past
    // the turn of the day). 8840 and 8841.
    ...[
      ["8840", "2026-11-22T23:30:00Z"],
      ["8841", "2026-11-23T00:30:00Z"],
    ].map(([port, now]) => ({
      command: "npx tsx tests/fixtures/midnight-server.ts",
      url: `http://127.0.0.1:${port}/health`,
      reuseExistingServer: false,
      env: { ARNOLD_UI: "legacy", E2E_NOW: now, MIDNIGHT_PORT: port },
    })),
    // The Skybridge views as the default serves them: 8850 with invented
    // history (overview, screens, chat cards), 8851 a new account (setup).
    {
      command: "npx tsx tests/fixtures/skybridge-server.ts",
      url: "http://127.0.0.1:8850/health",
      reuseExistingServer: false,
      env: { ARNOLD_UI: "" },
    },
  ],
});
