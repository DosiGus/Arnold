import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:8892";

test("T3-02 one refresh does not start a recurring dashboard request loop", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/mcp") && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body?.method === "tools/call") calls.push(body.params.name);
    }
  });
  await page.goto(`${origin}/preview`);
  await expect(page.locator(".stat-card").first()).toBeVisible();
  const before = calls.filter(
    (name) => name === "get_arnold_dashboard_v2",
  ).length;
  await page
    .getByRole("button", { name: "Trainingsdaten aktualisieren", exact: true })
    .click();
  await page.waitForTimeout(700);
  const triggered =
    calls.filter((name) => name === "get_arnold_dashboard_v2").length - before;
  await test.info().attach("refresh-request-count", {
    body: JSON.stringify({ triggered, window_ms: 700 }),
    contentType: "application/json",
  });
  await expect
    .soft(
      page.getByRole("button", {
        name: "Trainingsdaten aktualisieren",
        exact: true,
      }),
    )
    .toBeEnabled({ timeout: 1000 });
  expect(triggered).toBeLessThanOrEqual(2);
});

test("T3-05 clicking a cancelled recent workout opens that workout", async ({
  page,
}) => {
  await page.goto(`${origin}/preview`);
  await expect(page.locator(".recent-card")).toBeVisible();
  await page
    .locator(".recent-card .history-row")
    .filter({ hasText: "Abgebrochene Einheit" })
    .click();
  await expect(page.locator(".workout-detail h2")).toHaveText(
    "Abgebrochene Einheit",
    { timeout: 2500 },
  );
});

test("T3-04 progress KPI and graph explicitly identify per-dumbbell load", async ({
  page,
}) => {
  await page.goto(`${origin}/preview`);
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name: "Fortschritt", exact: true })
    .click();
  await page
    .getByLabel("Übung", { exact: true })
    .selectOption("ex-test-row-single");
  await expect(
    page.getByRole("heading", { name: "Testrudern einarmig", exact: true }),
  ).toBeVisible();
  const card = page
    .locator(".stat-card")
    .filter({ hasText: "Maximale vergleichbare Last" });
  await test.info().attach("progress-kpi", {
    body: await card.innerText(),
    contentType: "text/plain",
  });
  await page.screenshot({
    path: "test-results/qa-task003-progress.png",
    fullPage: true,
  });
  await expect(card).toContainText("pro Hantel", { timeout: 2000 });
  await expect(card).toContainText("Einseitig · Links · kg pro Hantel");
  await expect(page.locator(".chart-scope")).toHaveText(
    "Dargestellte Ausführung: Einseitig · Links · kg pro Hantel",
  );
  await page
    .getByLabel("Kennzahl", { exact: true })
    .selectOption("estimated_1rm");
  await expect(page.locator(".chart-scope")).toContainText("Einseitig · Links");
  await expect(
    page.locator(".stat-card").filter({ hasText: "Bestes geschätztes 1RM" }),
  ).toContainText("Einseitig · Links · kg pro Hantel");
  await page
    .getByLabel("Kennzahl", { exact: true })
    .selectOption("nominal_volume");
  await expect(page.locator(".chart-scope")).toHaveText(
    "Alle Ausführungsarten",
  );
  await expect(page.locator(".progress-chart-card")).not.toContainText(
    "Dargestellte Ausführung:",
  );
});

test("T3-06 overview exposes a period filter for weekly development", async ({
  page,
}) => {
  await page.goto(`${origin}/preview`);
  await expect(page.locator(".volume-card")).toBeVisible();
  await expect(page.locator('#main-content input[type="date"]')).toHaveCount(2);
});
