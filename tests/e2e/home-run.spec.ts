import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * RUN-014: the start screen shows the next run and the plan overview shows the
 * run sessions. The fixture server has run tools but no runs, so `get_run_week`
 * is answered here with invented data; every run figure on screen must come
 * from that answer, and a failed read must show none. The days of the week
 * come from the server's dashboard answer (completed runs count there since
 * RUN-022), patched here to hold one run day; the UI must show them unchanged.
 */
const BASE = "http://127.0.0.1:8804";
const SHOTS = resolve("test-results/screens");
mkdirSync(SHOTS, { recursive: true });

const localDate = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Intl.DateTimeFormat("en-CA").format(d);
};
const TODAY = localDate();
const TOMORROW = localDate(1);

const run = (over: Record<string, unknown> = {}) => ({
  workout_id: "run-0001",
  session_id: "s-base",
  name: "Lockerer Dauerlauf",
  run_type: "base",
  environment: "outdoor",
  status: "planned",
  level: 2,
  minutes: 45,
  minutes_reserved: false,
  intense_minutes: null,
  timer_s: null,
  distance_m: null,
  rpe: null,
  changed: false,
  ...over,
});
const weekWith = (runDay: number, over: Record<string, unknown> = {}) => ({
  today: TODAY,
  week_start: TODAY,
  week_end: localDate(6),
  days: [0, 1, 2].map((n) => ({
    date: localDate(n),
    weekday: ((new Date().getDay() + 6 + n) % 7) + 1,
    is_today: n === 0,
    runs: n === runDay ? [run(over)] : [],
    strength: [],
  })),
  summary: {
    runs_planned: 1,
    runs_completed: 0,
    runs_missed: 0,
    strength_planned: 0,
    strength_completed: 0,
    run_minutes_completed: null,
  },
  sessions: [],
  suggestions: [],
  notes: [],
});
const runView = () => ({
  workout_id: "run-0001",
  row_revision: 1,
  workout_date_local: TODAY,
  status: "planned",
  run_type: "base",
  environment: "outdoor",
  name: "Lockerer Dauerlauf",
  hint: null,
  planned: {
    total_s: 2700,
    distance_m: null,
    segments: 3,
    has_pace_targets: false,
    alarms: { hr: true, pace: false, lo: false },
  },
  result: null,
  unknown: [],
});

const json = (
  route: Route,
  structured: unknown,
  isError = false,
  meta?: object,
) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: route.request().postDataJSON().id,
      result: {
        content: [],
        ...(structured === undefined ? {} : { structuredContent: structured }),
        ...(meta ? { _meta: meta } : {}),
        ...(isError ? { isError } : {}),
      },
    }),
  });

type Mocks = {
  /** Answer for get_run_week; `undefined` makes the read fail. */
  week?: () => unknown;
  /** Edits the structured answer of a real tool call before it is used. */
  patch?: Record<string, (value: any) => void>;
};

/** Run tools are mocked; patched tools are answered by the real server first. */
async function mock(page: Page, card: string, mocks: Mocks) {
  const calls: string[] = [];
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.method !== "tools/call") return route.continue();
    const tool = body.params.name as string;
    if (tool === "show_arnold_run") {
      calls.push(tool);
      return json(route, {
        run_card_contract: "arnold.run_card/1",
        card,
        workout_id: null,
      });
    }
    if (tool === "get_run_week") {
      calls.push(tool);
      const value = mocks.week?.();
      return value === undefined
        ? json(route, undefined, true, {
            arnold: {
              code: "STORAGE_UNAVAILABLE",
              retryable: true,
              recovery: "retry_same_request",
            },
          })
        : json(route, value);
    }
    if (tool === "get_run_analysis") {
      calls.push(tool);
      return json(route, {
        view: "run",
        reference_date: TODAY,
        run: { view: runView(), metrics: {} },
        weeks: [],
        load_ratio: null,
        notes: [],
      });
    }
    const patch = mocks.patch?.[tool];
    if (!patch) return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    if (payload.result?.structuredContent)
      patch(payload.result.structuredContent);
    return route.fulfill({ response, json: payload });
  });
  return calls;
}

const training = (page: Page) =>
  page.getByRole("region", { name: "Dein Training", exact: true });
const weekTile = (page: Page) => page.getByRole("button", { name: /^Woche/ });

async function openHome(page: Page) {
  await page.goto(`${BASE}/preview?card=home`);
  await expect(page.locator('main[data-card="home"]')).toBeVisible();
}
async function noOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const theme of ["light", "dark"] as const) {
  test(`start screen shows the next run (${theme}, 375 px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await mock(page, "run_week", { week: () => weekWith(1) });
    await openHome(page);
    const next = training(page).getByRole("button", {
      name: /^Nächster Lauf Lockerer Dauerlauf/,
    });
    await expect(next).toBeVisible();
    await expect(next).toContainText("45 Min.");
    await expect(next).toContainText("Nächster Lauf");
    await noOverflow(page);
    await page.screenshot({
      path: `${SHOTS}/home-run-${theme}.png`,
      fullPage: true,
    });
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
  });
}

test("tapping the next run opens the run week, today's run opens run_today", async ({
  page,
}) => {
  const calls = await mock(page, "run_week", { week: () => weekWith(1) });
  await openHome(page);
  await training(page)
    .getByRole("button", { name: /^Nächster Lauf/ })
    .click();
  await expect(page.locator('main[data-card="run_week"]')).toBeVisible();
  expect(calls).toContain("show_arnold_run");

  const second = await page.context().newPage();
  await mock(second, "run_today", { week: () => weekWith(0) });
  await openHome(second);
  await expect(
    training(second).getByRole("button", { name: /^Nächster Lauf.*Heute/ }),
  ).toBeVisible();
  await training(second)
    .getByRole("button", { name: /^Nächster Lauf/ })
    .click();
  await expect(second.locator('main[data-card="run_today"]')).toBeVisible();
});

test("an unknown duration is shown as unknown, not as 0", async ({ page }) => {
  await mock(page, "run_week", {
    week: () => weekWith(1, { minutes: null }),
  });
  await openHome(page);
  const next = training(page).getByRole("button", { name: /^Nächster Lauf/ });
  await expect(next).toContainText("–");
  await expect(next).not.toContainText(/\b0 Min\./);
});

test("a week without runs leaves the start screen as it was", async ({
  page,
}) => {
  await mock(page, "run_week", {
    week: () => weekWith(-1),
  });
  await openHome(page);
  await expect(training(page).getByText("Nächster Lauf")).toHaveCount(0);
  await expect(training(page).getByText(/nicht laden/)).toHaveCount(0);
  await expect(
    training(page).getByRole("button", { name: /^Training/ }),
  ).toBeVisible();
});

test("a failed run read shows a notice and no run figures", async ({
  page,
}) => {
  await mock(page, "run_week", {});
  await openHome(page);
  await expect(
    training(page).getByText(
      "Deinen nächsten Lauf konnten wir gerade nicht laden.",
    ),
  ).toBeVisible();
  await expect(training(page).getByText("Nächster Lauf")).toHaveCount(0);
  await expect(training(page).getByText(/Min\./)).toHaveCount(0);
  // The rest of the start screen is unaffected.
  await expect(weekTile(page)).toBeVisible();
});

test("the week shows the training days the server sent, runs included", async ({
  page,
}) => {
  let ringBefore = 0;
  let runDate = "";
  const addRunDay = (dashboard: any) => {
    const current = dashboard.weeks.find((w: any) => w.is_current_week);
    runDate = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${current.week_start}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    }).find((d) => !current.trained_dates.includes(d))!;
    current.trained_dates.push(runDate);
    ringBefore = dashboard.home.streak.current_week_training_days;
    dashboard.home.streak.current_week_training_days += 1;
  };
  await mock(page, "run_week", {
    week: () => weekWith(1),
    patch: {
      show_arnold_dashboard: addRunDay,
      get_arnold_dashboard: addRunDay,
    },
  });
  await openHome(page);
  const ring = weekTile(page).locator(".ac-widget-ring");
  await expect(ring).toHaveAttribute(
    "aria-label",
    new RegExp(`^${ringBefore + 1} (von \\d+ )?Trainingstage`),
  );
  await weekTile(page).click();
  const days = page.getByRole("region", { name: "Woche im Detail" });
  await expect(
    days.locator(
      `.ac-widget-week-days [aria-label$=", trainiert"], .ac-widget-week-days [aria-label*=", trainiert,"]`,
    ),
  ).not.toHaveCount(0);
  const day = Number(runDate.slice(-2));
  await expect(
    days.locator(".ac-widget-week-days .done").filter({ hasText: String(day) }),
  ).toHaveCount(1);
});

test("the plan overview lists the run sessions as Laufeinheit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mock(page, "run_week", {
    patch: {
      get_plan_editor_context: (context) => {
        context.plan.run_sessions = [
          {
            plan_run_session_id: "prs-1",
            session_id: "run-session-1",
            session_name: "Lockerer Dauerlauf",
            session_order: 1,
            run_type: "base",
            template: { level: 2 },
            preferred_weekday: 2,
            status: "active",
            row_revision: 1,
          },
          {
            plan_run_session_id: "prs-2",
            session_id: "run-session-2",
            session_name: "Langer Lauf",
            session_order: 2,
            run_type: "long",
            template: { level: 1 },
            preferred_weekday: null,
            status: "active",
            row_revision: 1,
          },
        ];
      },
    },
  });
  await page.goto(`${BASE}/preview?card=plan`);
  await expect(page.locator('main[data-card="plan"]')).toBeVisible();
  const rows = page.getByRole("list", { name: "Laufeinheiten" });
  await expect(rows).toBeVisible();
  await expect(rows.getByText("Laufeinheit", { exact: true })).toHaveCount(2);
  await expect(rows).toContainText("Lockerer Dauerlauf");
  await expect(rows).toContainText("Grundlagenlauf · Dienstag · Aktiv");
  await expect(rows).toContainText("Langer Lauf Laufeinheit");
  await expect(rows).toContainText("Tag frei · Aktiv");
  // Editing stays with the existing button and the chat.
  await expect(
    page.getByRole("button", { name: /Plan bearbeiten|Training ansehen/ }),
  ).toBeVisible();
  await noOverflow(page);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.screenshot({
    path: `${SHOTS}/plan-run-sessions.png`,
    fullPage: true,
  });
});

test("a plan without run sessions shows no Laufeinheit", async ({ page }) => {
  await mock(page, "run_week", {});
  await page.goto(`${BASE}/preview?card=plan`);
  await expect(page.locator('main[data-card="plan"]')).toBeVisible();
  await expect(page.getByText("Laufeinheit")).toHaveCount(0);
});
