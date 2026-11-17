import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { berlinToday } from "../fixtures/berlin-today";

/**
 * Watch workouts in the history and on the start screen (GAR-B5-02). The
 * fixture server has no database and so no recordings: its real answers are
 * taken and one workout gets what the server adds for a watch upload.
 */
const BASE = "http://127.0.0.1:8792";

const recorded = {
  started_at_utc: "2026-11-04T17:00:00Z",
  ended_at_utc: "2026-11-04T17:45:00Z",
  duration_s: 2700,
  rest: {
    measured_pauses: 3,
    planned_s: 180,
    actual_s: 250,
    delta_s: 70,
    ratio_pct: 138.9,
  },
  health: {
    heart_rate: {
      average_bpm: 119.6,
      max_bpm: 150,
      measured_seconds: 20,
      missing_seconds: 5,
    },
    heart_rate_curve: [90, 104, null, 120, 150, 132],
    calories_kcal: 280,
    before: { body_battery: 64, stress: 31, resting_hr: null },
    after: { body_battery: 48, stress: null, resting_hr: null },
    differences: { body_battery: -16, stress: null, resting_hr: null },
  },
};

type Workout = Record<string, unknown> & { workout_id: string };

/** Rewrites one tool's real answer before the app sees it. */
async function rewrite(
  page: Page,
  tool: string | string[],
  change: (content: Record<string, unknown>) => void,
) {
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (![tool].flat().includes(body?.params?.name)) return route.continue();
    const response = await route.fetch();
    const json = await response.json();
    if (json.result?.structuredContent) change(json.result.structuredContent);
    await route.fulfill({ response, json });
  });
}

test("a watch workout shows its badge, duration, rests, heart rate and before/after values", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let watchId = "";
  let plainId = "";
  await rewrite(page, "get_arnold_workouts", (content) => {
    const workouts = content.workouts as Workout[];
    if (!workouts.length) return;
    workouts[0].from_watch = true;
    workouts[0].watch = recorded;
    watchId = workouts[0].workout_id;
    if (workouts[1]) {
      // Recorded, but without consent: no health data.
      workouts[1].from_watch = true;
      workouts[1].watch = { ...recorded, health: null };
      plainId = workouts[1].workout_id;
    }
  });
  await page.goto(`${BASE}/preview?card=history`);
  await expect(
    page.getByRole("heading", { name: "Deine Einheiten" }),
  ).toBeVisible();
  expect(watchId).not.toBe("");
  const rows = page.locator(".ac-history-row");
  await expect(rows.first().getByText("Von der Uhr")).toBeVisible();
  await rows.first().click();
  const recording = page.getByRole("list", { name: "Von der Uhr" });
  await expect(recording).toContainText("45 min");
  await expect(recording).toContainText("4:10 · geplant 3:00");
  await expect(recording).toContainText("Ø 120 · max 150");
  await expect(recording).toContainText("280 kcal");
  await expect(recording).toContainText("64 → 48");
  await expect(recording).toContainText("31 → –");
  await expect(
    page.getByRole("img", { name: /^Pulsverlauf, Durchschnitt 120/ }),
  ).toBeVisible();
  // The gap breaks the line: two segments, never a drop to zero.
  await expect(page.locator("svg[role=img] polyline")).toHaveCount(2);
  const a11y = await new AxeBuilder({ page }).include("main").analyze();
  expect(
    a11y.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
  for (const width of [375, 1024])
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await page.screenshot({
        path: resolve(
          `test-results/screens/${browserName}-watch-history-${width}-${theme}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    }
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  if (plainId) {
    await rows.nth(1).click();
    await expect(
      page.getByText("Zu diesem Training hat Arnold keine Messwerte der Uhr."),
    ).toBeVisible();
    await expect(page.getByText("280 kcal")).toHaveCount(0);
  }
});

test("the start screen marks today's training from the watch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const markToday = (content: Record<string, unknown>) => {
    const recent = content.recent_workouts as Workout[] | undefined;
    if (!recent?.length) return;
    recent[0].date = berlinToday();
    recent[0].status = "completed";
    recent[0].from_watch = true;
  };
  // The card asks again with its time zone; both answers carry the change.
  await rewrite(
    page,
    ["show_arnold_dashboard", "get_arnold_dashboard"],
    markToday,
  );
  await page.goto(`${BASE}/preview`);
  await expect(
    page
      .getByRole("region", { name: "Dein Training", exact: true })
      .getByText("Von der Uhr", { exact: true }),
  ).toBeVisible();
});
