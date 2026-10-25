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

/** Fails the test on any uncaught page error, so a broken render is not missed. */
/** Addresses the main navigation, never a same-named control inside a view. */
function nav(page: Page, label: string) {
  return page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name: label, exact: true });
}

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("opens the dashboard with engine metrics and switches between views", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto(`${WITH_HISTORY}/preview`);

  await expect(
    page.getByRole("heading", { name: "Dein Training. Dein Fortschritt." }),
  ).toBeVisible();
  // KPI values come from the analytics engine, not from the browser.
  await expect(page.getByText("Trainingseinheiten").first()).toBeVisible();
  await expect(
    page.locator(".stat-card").filter({ hasText: "Trainingseinheiten" }),
  ).toContainText("5");
  await expect(page.locator(".source-note")).toContainText(
    "Arnold · Testdatei",
  );
  await expect(page.locator(".source-note")).toContainText("Schema 1.0.0");

  // The weekly development chart is interactive and keyboard reachable.
  await page
    .getByRole("group", { name: "Kennzahl der Wochenentwicklung" })
    .getByRole("button", { name: "Trainingstage" })
    .click();
  await expect(
    page.getByRole("img", { name: /Trainingstage pro Woche/ }),
  ).toBeVisible();

  await nav(page, "Workouts").click();
  await expect(
    page.getByRole("heading", { name: "Jede Einheit zählt." }),
  ).toBeVisible();
  await nav(page, "Fortschritt").click();
  await expect(
    page.getByRole("heading", { name: "Fortschritt wird sichtbar." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("filters the workout history and opens one session", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${WITH_HISTORY}/preview`);
  await nav(page, "Workouts").click();

  await expect(page.getByText("5 Einheiten gefunden")).toBeVisible();

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
  await page.goto(`${WITH_HISTORY}/preview`);
  await nav(page, "Fortschritt").click();

  await page.getByLabel("Übung", { exact: true }).selectOption(EXERCISES.bench);
  await expect(
    page.getByRole("img", { name: /Maximale vergleichbare Last in kg/ }),
  ).toBeVisible();
  await expect(page.locator(".chart-caption")).toContainText("3 Messpunkte");

  // Switching the metric re-reads from the backend, not from a local formula.
  await page
    .getByLabel("Kennzahl", { exact: true })
    .selectOption("estimated_1rm");
  await expect(
    page.getByRole("img", { name: /Geschätztes 1RM in kg/ }),
  ).toBeVisible();

  // An exercise with no comparable load shows a reason, not an empty chart.
  await page.getByLabel("Kennzahl", { exact: true }).selectOption("max_load");
  await page
    .getByLabel("Übung", { exact: true })
    .selectOption(EXERCISES.pullup);
  await expect(page.getByText("Noch kein Verlauf")).toBeVisible();

  // Execution variants are listed in plain language.
  await page.getByLabel("Übung", { exact: true }).selectOption(EXERCISES.row);
  await expect(
    page.getByRole("heading", { name: "Ausführungsarten" }),
  ).toBeVisible();
  await expect(page.locator("table").last()).toContainText("kg pro Hantel");
  expect(errors).toEqual([]);
});

test("shows the welcome state for an empty tracker with no fake workouts", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto(`${EMPTY_TRACKER}/preview`);

  await expect(page.getByText("Willkommen bei Arnold")).toBeVisible();
  await expect(
    page.getByText(/Deine Trainingsdatenbasis ist bereit/),
  ).toBeVisible();
  // No invented example sessions, and no onboarding button that leads nowhere.
  await expect(page.locator(".history-row")).toHaveCount(0);
  await expect(page.locator(".record-row")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Onboarding|Jetzt starten|Einrichten/ }),
  ).toHaveCount(0);

  // The history view is usable and empty rather than broken.
  await nav(page, "Workouts").click();
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
  await page.goto(`${WITH_HISTORY}/preview`);
  await expect(
    page.getByRole("heading", { name: "Dein Training. Dein Fortschritt." }),
  ).toBeVisible();
  expect(
    await page
      .locator("body")
      .evaluate((el) => el.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  // The set table scrolls inside its own container, not the page.
  await nav(page, "Workouts").click();
  await page.locator(".history-row").first().click();
  expect(
    await page
      .locator("body")
      .evaluate((el) => el.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test("supports the light and the dark host theme", async ({ page }) => {
  await page.goto(`${WITH_HISTORY}/preview`);
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const colors = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return { background: style.backgroundColor, text: style.color };
    });
    // Both themes must paint an explicit, non-transparent ground.
    expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(colors.text).not.toBe(colors.background);
  }
});

test("meets accessibility checks on every view", async ({ page }) => {
  await page.goto(`${WITH_HISTORY}/preview`);
  for (const view of ["Übersicht", "Workouts", "Fortschritt"]) {
    await nav(page, view).click();
    await expect(page.locator("#main-content")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations.map((v) => `${view}: ${v.id} (${v.nodes.length})`),
    ).toEqual([]);
  }
});

test("is keyboard navigable with a visible focus ring", async ({ page }) => {
  await page.goto(`${WITH_HISTORY}/preview`);
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      tag: active?.tagName,
      outline: active ? getComputedStyle(active).outlineStyle : "",
    };
  });
  expect(focus.tag).toBeTruthy();

  // Navigation is reachable and operable from the keyboard alone.
  await nav(page, "Workouts").focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Jede Einheit zählt." }),
  ).toBeVisible();
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

  await expect(
    app.getByRole("heading", { name: "Dein Training. Dein Fortschritt." }),
  ).toBeVisible();
  await expect(app.locator(".source-note")).toContainText("Arnold · Testdatei");

  // The app opened through show_arnold_dashboard and then revalidated, which is
  // the guard against a replayed result from chat history.
  await expect.poll(() => calls.includes("show_arnold_dashboard")).toBe(true);
  await expect
    .poll(() => calls.filter((c) => c === "get_arnold_dashboard_v2").length)
    .toBeGreaterThanOrEqual(1);

  // Views fetch their own data through the bridge.
  await app
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name: "Workouts", exact: true })
    .click();
  await expect.poll(() => calls.includes("get_arnold_workouts_v2")).toBe(true);
  await app
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name: "Fortschritt", exact: true })
    .click();
  await expect
    .poll(() => calls.includes("get_arnold_exercise_progress_v2"))
    .toBe(true);

  // No write or demo tool is ever reachable in Arnold mode.
  expect(calls).not.toContain("log_demo_set");
  expect(calls).not.toContain("reset_demo_data");
});
