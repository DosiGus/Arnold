import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "webkit",
      use: { browserName: "webkit" },
      // The midnight tests write the same day twice; Chromium covers them.
      testIgnore: ["**/midnight.spec.ts"],
    },
  ],
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8850",
    timezoneId: "Europe/Berlin",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    // The card views in the local test host: 8850 with invented history
    // (overview, screens, chat cards), 8852 a plan without history (adjustment),
    // 8851 a new account (setup). WebKit gets its own three: 8860-8862.
    ...["8850", "8860"].map((port) => ({
      command: "npx tsx tests/fixtures/skybridge-server.ts",
      url: `http://127.0.0.1:${port}/health`,
      reuseExistingServer: false,
      env: { SKYBRIDGE_PORT: port },
    })),
    // DATE-001: the overview on a clock shortly before and after midnight UTC
    // (22 Nov 23:30 and 23 Nov 00:30 UTC; Berlin is already or just past the
    // turn of the day). 8840 and 8841.
    ...[
      ["8840", "2026-11-22T23:30:00Z"],
      ["8841", "2026-11-23T00:30:00Z"],
    ].map(([port, now]) => ({
      command: "npx tsx tests/fixtures/midnight-server.ts",
      url: `http://127.0.0.1:${port}/health`,
      reuseExistingServer: false,
      env: { E2E_NOW: now, MIDNIGHT_PORT: port },
    })),
  ],
});
