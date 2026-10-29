/**
 * Browser regressions for the QA findings on Task 003.
 *
 * The assertions on request counts are deliberately **upper** bounds. The
 * original bridge test asserted `toBeGreaterThanOrEqual(1)`, which an unbounded
 * request loop satisfies — that is how a runaway refresh went unnoticed.
 */
import { test, expect, type Page } from "@playwright/test";
import { EXERCISES } from "../fixtures/arnold-dashboard";

const WITH_HISTORY = "http://127.0.0.1:8792";

function nav(page: Page, label: string) {
  return page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name: label, exact: true });
}

/** Counts every MCP tool call the page makes. */
function countCalls(page: Page) {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/mcp") && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body?.method === "tools/call") calls.push(body.params.name);
    }
  });
  return calls;
}

test("T3-02: one refresh click settles instead of looping", async ({
  page,
}) => {
  const calls = countCalls(page);
  await page.goto(`${WITH_HISTORY}/preview`);
  await expect(
    page.getByRole("heading", { name: "Dein Überblick." }),
  ).toBeVisible();
  const atOpen = calls.length;

  await page
    .getByRole("button", { name: "Trainingsdaten aktualisieren" })
    .click();
  await page.waitForTimeout(1200);
  const afterRefresh = calls.length - atOpen;

  // One action, one request. The loop produced hundreds.
  expect(afterRefresh).toBeGreaterThanOrEqual(1);
  expect(afterRefresh).toBeLessThanOrEqual(3);

  // And it stays settled.
  const settled = calls.length;
  await page.waitForTimeout(1500);
  expect(calls.length).toBe(settled);
});

test("T3-02: opening the dashboard issues a bounded number of calls", async ({
  page,
}) => {
  const calls = countCalls(page);
  await page.goto(`${WITH_HISTORY}/preview`);
  await expect(
    page.getByRole("heading", { name: "Dein Überblick." }),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  expect(calls.length).toBeLessThanOrEqual(3);
});

test("T3-05: clicking a cancelled session opens that session", async ({
  page,
}) => {
  await page.goto(`${WITH_HISTORY}/preview`);
  // Cancelled entries remain reachable in the full history, outside the
  // motivational overview's last-completed-session card.
  await nav(page, "Verlauf").click();
  await page.locator(".filter-disclosure summary").click();
  await page.getByLabel("Abgebrochene und offene Einheiten zeigen").check();
  const card = page.getByRole("button", {
    name: /Abgebrochene Einheit am 20\. Oktober 2026/,
  });
  await expect(card).toBeVisible();
  await card.click();

  // The detail panel must show exactly that session, not a neighbouring one.
  const detail = page.locator(".workout-detail");
  await expect(detail.getByRole("heading", { level: 2 })).toHaveText(
    "Abgebrochene Einheit",
  );
  await expect(detail).toContainText("20. Oktober 2026");
  await expect(detail).not.toContainText("Freies Training");
});

test("T3-06: period controls live in history and do not reset the overview", async ({
  page,
}) => {
  await page.goto(`${WITH_HISTORY}/preview`);
  await expect(page.locator(".performance-strip .stat-card")).toHaveCount(3);
  await expect(page.getByLabel("Übersicht von")).toHaveCount(0);
  await nav(page, "Verlauf").click();
  await page.locator(".filter-disclosure summary").click();
  await page.getByLabel("Workouts von").fill("2030-01-01");
  await page.getByLabel("Workouts bis").fill("2030-01-31");
  await expect(
    page.getByText("Keine Einheiten gefunden").first(),
  ).toBeVisible();
  await expect(page.getByText("Willkommen bei Arnold")).toHaveCount(0);
  await expect(page.locator(".history-row")).toHaveCount(0);
  await page.getByLabel("Workouts von").fill("2026-10-01");
  await page.getByLabel("Workouts bis").fill("2026-10-31");
  await expect(page.locator(".history-row").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /am 14\. September 2026/ }),
  ).toHaveCount(0);
  await nav(page, "Überblick").click();
  await expect(
    page
      .locator(".stat-card")
      .filter({ has: page.getByText("Trainings", { exact: true }) }),
  ).toContainText("5");
});

test("T3-04: the progress view names the load convention", async ({ page }) => {
  await page.goto(`${WITH_HISTORY}/preview`);
  await nav(page, "Fortschritt").click();
  await page.getByLabel("Übung", { exact: true }).selectOption(EXERCISES.row);

  // The dumbbell max load must not read as a total load.
  const maxCard = page
    .locator(".stat-card")
    .filter({ hasText: "Maximale vergleichbare Last" });
  await expect(maxCard).toContainText("kg pro Hantel");

  // The 1RM is computed and still carries its caveat.
  await page
    .getByRole("group", { name: "Kennzahl" })
    .getByRole("button", { name: "1RM", exact: true })
    .click();
  const oneRm = page
    .locator(".stat-card")
    .filter({ hasText: "Bestes geschätztes 1RM" });
  await expect(oneRm).toContainText("nicht als Gesamtlast");

  // The curve says which convention it plots.
  await expect(page.locator(".chart-caption").first()).toContainText(
    "pro Hantel",
  );
  await expect(page.locator("body")).not.toContainText("per_implement");
});

test("T3-09: the progress view fits a 390px screen with variants", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WITH_HISTORY}/preview`);
  await nav(page, "Fortschritt").click();
  // The unilateral exercise is the one that renders the variants table.
  await page.getByLabel("Übung", { exact: true }).selectOption(EXERCISES.row);
  await page.locator(".progress-details summary").click();
  await expect(page.locator(".progress-details")).toHaveAttribute("open", "");

  const overflow = await page.locator("body").evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
});
