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

async function openCard(page: Page, card: string) {
  await page.goto(`${WITH_HISTORY}/preview?card=${card}`);
  await expect(page.locator(`main[data-card="${card}"]`)).toBeVisible();
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

test("T3-02: moving between cards settles instead of looping", async ({
  page,
}) => {
  const calls = countCalls(page);
  await openCard(page, "week");
  await page.waitForTimeout(800);
  const atOpen = calls.length;

  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(page.getByText(/Einheiten gefunden/)).toBeVisible();
  await page.waitForTimeout(1200);
  const afterClick = calls.length - atOpen;

  // One action, a handful of requests. The old loop produced hundreds.
  expect(afterClick).toBeGreaterThanOrEqual(1);
  expect(afterClick).toBeLessThanOrEqual(3);

  // And it stays settled.
  const settled = calls.length;
  await page.waitForTimeout(1500);
  expect(calls.length).toBe(settled);
});

test("T3-02: opening a card issues a bounded number of calls", async ({
  page,
}) => {
  for (const card of ["today", "week"]) {
    const calls = countCalls(page);
    await openCard(page, card);
    await page.waitForTimeout(1200);
    expect(calls.length, card).toBeLessThanOrEqual(4);
    page.removeAllListeners("request");
  }
});

test("T3-05: clicking a cancelled session opens that session", async ({
  page,
}) => {
  // Cancelled entries remain reachable in the full history, outside the
  // week card's last-completed-session line.
  await openCard(page, "history");
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

test("T3-06: period controls live in history and do not reset the week card", async ({
  page,
}) => {
  await openCard(page, "week");
  await expect(page.getByLabel("Übersicht von")).toHaveCount(0);
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
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
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await expect(
    page.locator('main[data-card="week"] .ac').first(),
  ).toContainText("Arbeitssätze");
});

test("T3-04: the progress view names the load convention", async ({ page }) => {
  await openCard(page, "progress");
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
  await openCard(page, "progress");
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
