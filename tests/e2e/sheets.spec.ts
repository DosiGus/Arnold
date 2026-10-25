import { test, expect } from "@playwright/test";

test("Sheets mode renders source, dynamic records and refresh without demo mutations", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/mcp") && req.method() === "POST") {
      const body = req.postDataJSON();
      if (body.method === "tools/call") calls.push(body.params.name);
    }
  });
  await page.goto("http://127.0.0.1:8791/host");
  const app = page.frameLocator("iframe");
  await expect(
    app.getByRole("heading", { name: "Dein Training. Dein Fortschritt." }),
  ).toBeVisible();
  await expect(app.locator(".source-note")).toContainText(
    "Test-Tracker · Trainingslog",
  );
  await expect(app.locator(".source-note")).toContainText("effektive Last");
  await expect(
    app.getByRole("button", { name: "Training eintragen", exact: true }),
  ).toHaveCount(0);
  await expect(
    app.getByRole("button", { name: /Demo.*zurücksetzen/ }),
  ).toHaveCount(0);
  await expect(app.locator(".record-row")).toHaveCount(2);
  await expect(
    app.locator(".stat-value").filter({ hasText: /^780/ }),
  ).toBeVisible();
  await app
    .getByRole("button", { name: "Trainingsdaten aktualisieren", exact: true })
    .click();
  await expect(app.getByRole("status")).toContainText(
    "Trainingsdaten aktualisiert",
  );
  expect(
    calls.filter((c) => c === "get_dashboard_data").length,
  ).toBeGreaterThanOrEqual(2);
  await app.getByRole("button", { name: "Workouts", exact: true }).click();
  await expect(app.getByText("2 Workouts gefunden")).toBeVisible();
  await app.getByRole("button", { name: "Fortschritt", exact: true }).click();
  await expect(
    app.getByRole("heading", { name: "Testdrücken", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await app
      .locator("body")
      .evaluate((e) => e.scrollWidth <= window.innerWidth),
  ).toBe(true);
  expect(calls).not.toContain("log_demo_set");
  expect(calls).not.toContain("reset_demo_data");
});
