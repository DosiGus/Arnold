/**
 * Browser tests for the Arnold v2 dashboard.
 *
 * All three fixture servers serve synthetic in-memory data, so nothing here can
 * read or change real training data. 8792 has history, 8793 is an empty
 * tracker, 8794 has an unreachable source.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { EXERCISES } from "../fixtures/arnold-dashboard";

const WITH_HISTORY = "http://127.0.0.1:8792";
const EMPTY_TRACKER = "http://127.0.0.1:8793";
const UNAVAILABLE = "http://127.0.0.1:8794";

/** Opens one card directly, the way the model does with `card`. */
async function openCard(page: Page, base: string, card: string) {
  await page.goto(`${base}/preview?card=${card}`);
  await expect(page.locator(`main[data-card="${card}"]`)).toBeVisible();
}

/** Fails the test on any uncaught page error, so a broken render is not missed. */

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("opens the week card with engine numbers and leads on to other cards", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openCard(page, WITH_HISTORY, "week");

  // Numbers come from the analytics engine's week row, not from the browser.
  const card = page.locator(".ac").first();
  await expect(card).toContainText("Arbeitssätze");
  await expect(card).toContainText(/Trainingstag/);
  await expect(card).toContainText("Letzter Rekord");
  // There is no app frame inside the chat: no menu, logo or page title.
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveCount(0);
  // At most two buttons per card.
  await expect(card.locator(".ac-actions button")).toHaveCount(2);

  await card.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(page.locator('main[data-card="history"]')).toBeVisible();
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await page
    .locator(".ac")
    .first()
    .getByRole("button", { name: "Fortschritt", exact: true })
    .click();
  await expect(page.locator('main[data-card="progress"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("opens on today's planned session by default", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${WITH_HISTORY}/preview`);
  await expect(page.locator('main[data-card="today"]')).toBeVisible();
  const card = page.locator(".ac").first();
  await expect(card).toContainText("Heute");
  await expect(card).toContainText("Testplan Oberkörper v2");
  // A read-only connection never offers a start that cannot be saved.
  await expect(card).toContainText("Nur Ansicht");
  await expect(
    card.getByRole("button", { name: "Training starten" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("filters the workout history and opens one session", async ({ page }) => {
  const errors = trackErrors(page);
  await openCard(page, WITH_HISTORY, "history");

  await expect(page.getByText("5 Einheiten gefunden")).toBeVisible();

  await page.locator(".filter-disclosure summary").click();
  // Session names come from the stored history, not from a fixed split.
  await page
    .getByLabel("Trainingseinheit", { exact: true })
    .selectOption("Oberkörper A");
  await expect(page.getByText("3 Einheiten gefunden")).toBeVisible();

  // Opening a session shows its sets exactly as entered.
  await page
    .getByRole("button", { name: /Oberkörper A am 7\. September 2026/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Testbankdrücken", exact: false }),
  ).toBeVisible();
  const rows = page.locator(".set-list tbody tr");
  await expect(rows.first()).toContainText("60 kg");
  await expect(rows.first()).toContainText("10");

  // A per-implement load is labelled in plain German, never as per_implement.
  await page.getByLabel("Trainingseinheit", { exact: true }).selectOption("");
  await expect(page.getByText("5 Einheiten gefunden")).toBeVisible();
  await page
    .getByRole("button", { name: /Oberkörper A am 5\. Oktober 2026/ })
    .click();
  // One exercise card per exercise, each keeping its own load convention.
  const detail = page.locator(".workout-detail");
  await expect(detail).toContainText("20 kg pro Hantel");
  await expect(detail).toContainText("Rechts");
  await expect(detail).toContainText("Links");
  // The bench block in the same session stays a plain total load.
  await expect(detail).toContainText("75 kg");
  await expect(page.locator("body")).not.toContainText("per_implement");

  // An archived plan version stays selectable for its own workouts.
  await page.getByLabel("Trainingsplan").selectOption("pv-test-1");
  await expect(page.getByText("2 Einheiten gefunden")).toBeVisible();

  // A filter with no match explains itself rather than erroring.
  await page.getByLabel("Workouts bis").fill("2020-01-01");
  await expect(
    page.getByText("Keine Einheiten gefunden").first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("shows a progress chart and an empty state for an untrained exercise", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openCard(page, WITH_HISTORY, "progress");

  await page.getByLabel("Übung", { exact: true }).selectOption(EXERCISES.bench);
  await expect(
    page.getByRole("img", { name: /Maximale vergleichbare Last in kg/ }),
  ).toBeVisible();
  await expect(page.locator(".chart-caption")).toContainText("3 Messpunkte");

  // Switching the metric re-reads from the backend, not from a local formula.
  await page
    .getByRole("group", { name: "Kennzahl" })
    .getByRole("button", { name: "1RM", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: /Geschätztes 1RM in kg/ }),
  ).toBeVisible();

  // An exercise with no comparable load shows a reason, not an empty chart.
  await page
    .getByRole("group", { name: "Kennzahl" })
    .getByRole("button", { name: "Kraft", exact: true })
    .click();
  await page
    .getByLabel("Übung", { exact: true })
    .selectOption(EXERCISES.pullup);
  await expect(page.getByText("Noch kein Verlauf")).toBeVisible();

  // Execution variants are listed in plain language.
  await page.getByLabel("Übung", { exact: true }).selectOption(EXERCISES.row);
  await page.locator(".progress-details summary").click();
  await expect(page.locator(".progress-details")).toHaveAttribute("open", "");
  await expect(page.locator("table").last()).toContainText("kg pro Hantel");
  expect(errors).toEqual([]);
});

test("shows the welcome state for an empty tracker with no fake workouts", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openCard(page, EMPTY_TRACKER, "week");

  await expect(page.getByText("Willkommen bei Arnold")).toBeVisible();
  await expect(
    page.getByText(/Dein erstes Training ist der Anfang/),
  ).toBeVisible();
  // No invented example sessions, and no onboarding button that leads nowhere.
  await expect(page.locator(".history-row")).toHaveCount(0);
  await expect(page.locator(".record-row")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Onboarding|Jetzt starten|Einrichten/ }),
  ).toHaveCount(0);

  // The history view is usable and empty rather than broken.
  await openCard(page, EMPTY_TRACKER, "history");
  await expect(page.getByText("0 Einheiten gefunden")).toBeVisible();
  expect(errors).toEqual([]);
});

test("reports an unreachable source without showing demo data", async ({
  page,
}) => {
  await page.goto(`${UNAVAILABLE}/preview`);
  await expect(page.getByRole("alert")).toContainText(
    "Google Sheets ist vorübergehend nicht verfügbar",
  );
  // A failed read must never be papered over with synthetic numbers.
  await expect(page.locator("body")).not.toContainText("Demo");
  await expect(page.locator(".stat-value")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Erneut verbinden" }),
  ).toBeVisible();
});

test("renders on a mobile viewport without horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const card of ["today", "week"]) {
    await openCard(page, WITH_HISTORY, card);
    expect(
      await page
        .locator("body")
        .evaluate((el) => el.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  }

  // The set table scrolls inside its own container, not the page.
  await openCard(page, WITH_HISTORY, "history");
  await page.locator(".history-row").first().click();
  expect(
    await page
      .locator("body")
      .evaluate((el) => el.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test("supports the light and the dark host theme", async ({ page }) => {
  await openCard(page, WITH_HISTORY, "week");
  const looks: string[] = [];
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const colors = await page
      .locator(".ac")
      .first()
      .evaluate((card) => {
        const style = getComputedStyle(card);
        return { surface: style.backgroundColor, text: style.color };
      });
    // The chat paints the page; each card brings its own visible surface.
    expect(colors.surface).not.toBe("rgba(0, 0, 0, 0)");
    expect(colors.text).not.toBe(colors.surface);
    looks.push(colors.text);
  }
  expect(looks[0]).not.toBe(looks[1]);
});

test("meets accessibility checks on every view", async ({ page }) => {
  // Measured at rest: the cards' short entrance fade would skew contrast.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const view of ["today", "week", "history", "progress"]) {
    await openCard(page, WITH_HISTORY, view);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations.map((v) => `${view}: ${v.id} (${v.nodes.length})`),
    ).toEqual([]);
  }
});

test("is keyboard navigable with a visible focus ring", async ({ page }) => {
  await openCard(page, WITH_HISTORY, "week");
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      tag: active?.tagName,
      outline: active ? getComputedStyle(active).outlineStyle : "",
    };
  });
  expect(focus.tag).toBeTruthy();

  // A card's buttons are reachable and operable from the keyboard alone.
  await openCard(page, WITH_HISTORY, "week");
  await page.getByRole("button", { name: "Verlauf", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('main[data-card="history"]')).toBeVisible();
});

test("drives the dashboard through the MCP Apps bridge in the test host", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/mcp") && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body?.method === "tools/call") calls.push(body.params.name);
    }
  });
  await page.goto(`${WITH_HISTORY}/host`);
  const app = page.frameLocator("iframe");

  await expect(app.locator('main[data-card="today"]')).toBeVisible();
  await expect(app.locator(".ac").first()).toContainText("Heute");

  // The app opened through show_arnold_dashboard and then revalidated, which is
  // the guard against a replayed result from chat history.
  await expect.poll(() => calls.includes("show_arnold_dashboard")).toBe(true);
  await expect
    .poll(() => calls.filter((c) => c === "get_arnold_dashboard").length)
    .toBeGreaterThanOrEqual(1);

  // Cards lead on to views that fetch their own data through the bridge.
  await app.getByRole("button", { name: "Überblick", exact: true }).click();
  await app.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect.poll(() => calls.includes("get_arnold_workouts")).toBe(true);
  await app.getByRole("button", { name: "Zurück", exact: true }).click();
  await app.getByRole("button", { name: "Fortschritt", exact: true }).click();
  await expect
    .poll(() => calls.includes("get_arnold_exercise_progress"))
    .toBe(true);

  // No write or demo tool is ever reachable in Arnold mode.
  expect(calls).not.toContain("log_demo_set");
  expect(calls).not.toContain("reset_demo_data");
});
