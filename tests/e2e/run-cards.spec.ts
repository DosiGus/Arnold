import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The five run cards (RUN-010). The fixture server has no run service, so the
 * run tools are answered here with invented data; every number on screen must
 * come from these answers, and a missing or failed answer must show none.
 */
const BASE = "http://127.0.0.1:8792";
const SHOTS = resolve("test-results/screens");
mkdirSync(SHOTS, { recursive: true });

type Handler = (
  args: Record<string, unknown>,
  call: number,
) => { value?: unknown; isError?: boolean; meta?: object } | undefined;
type Handlers = Record<string, Handler>;

const RUN = "run-0001";
const TODAY = "2026-11-12";

/* ------------------------------------------------------------- fixtures */

const view = (over: Record<string, unknown> = {}) => ({
  workout_id: RUN,
  row_revision: 3,
  workout_date_local: TODAY,
  status: "planned",
  run_type: "base",
  environment: "outdoor",
  name: "Lockerer Dauerlauf",
  hint: "Zone 2 laut Uhr. Du kannst dich dabei noch unterhalten.",
  planned: {
    total_s: 2700,
    distance_m: null,
    segments: 3,
    has_pace_targets: false,
    alarms: { hr: true, pace: false, lo: false },
  },
  result: null,
  unknown: [],
  ...over,
});
const doneView = (over: Record<string, unknown> = {}) =>
  view({
    status: "completed",
    result: {
      result_source: "watch",
      timer_s: 2712,
      elapsed_s: 2760,
      distance_m: 8200,
      distance_source: "gps",
      pace_s_per_km: 331,
      rpe: 4,
      hr_status: "no_consent",
      hr_avg_bpm: null,
      hr_max_bpm: null,
      calories_kcal: null,
      cadence_spm: null,
      ascent_m: null,
      descent_m: null,
      lap_count: 0,
    },
    ...over,
  });

const run = (over: Record<string, unknown> = {}) => ({
  workout_id: RUN,
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
const day = (
  n: number,
  runs: unknown[] = [],
  strength: unknown[] = [],
  today = false,
) => ({
  date: `2026-11-${String(8 + n).padStart(2, "0")}`,
  weekday: n,
  is_today: today,
  runs,
  strength,
});
const week = () => ({
  today: TODAY,
  week_start: "2026-11-09",
  week_end: "2026-11-15",
  days: [
    day(1, [
      run({
        workout_id: "run-0000",
        name: "Intervalle",
        status: "completed",
        run_type: "intervals",
        minutes: 40,
        timer_s: 2460,
        distance_m: 7400,
        rpe: 7,
      }),
    ]),
    day(
      2,
      [],
      [
        {
          workout_id: "kraft-1",
          name: "Oberkörper",
          status: "completed",
          working_sets: 12,
          leg_sets: null,
          heavy_legs: null,
        },
      ],
    ),
    day(3),
    day(4, [run()], [], true),
    day(5),
    day(6, [
      run({
        workout_id: "run-0002",
        session_id: "s-long",
        name: "Langer Lauf",
        run_type: "long",
        minutes: 75,
        level: 1,
        changed: true,
      }),
    ]),
    day(7),
  ],
  summary: {
    runs_planned: 3,
    runs_completed: 1,
    runs_missed: 0,
    strength_planned: 1,
    strength_completed: 1,
    run_minutes_completed: 41,
  },
  sessions: [],
  suggestions: [],
  notes: [
    {
      code: "info",
      text: "Der lange Lauf ist am Wochenende geplant.",
    },
  ],
});
const preview = (hash = "hash-a") => ({
  rules_version: "1",
  from: "2026-11-16",
  to: "2026-11-22",
  phase: "base",
  deload: false,
  volume_cap_minutes: 180,
  max_hard: 1,
  preview_hash: hash,
  days: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    date: `2026-11-${15 + n}`,
    weekday: n,
    is_today: false,
    runs:
      n === 2 || n === 6
        ? [
            run({
              workout_id: null,
              session_id: n === 2 ? "s-base" : "s-long",
              name: n === 2 ? "Lockerer Dauerlauf" : "Langer Lauf",
              status: "proposed",
              minutes: n === 2 ? 45 : 80,
            }),
          ]
        : [],
    strength: [],
  })),
  dropped: [
    {
      session_id: "s-tempo",
      session_name: "Tempodauerlauf",
      reason: "zu wenig freie Tage",
    },
  ],
  notes: [{ code: "deload", text: "Diese Woche bleibt es bewusst locker." }],
  levels: [{ session_id: "s-base", session_name: "Dauerlauf", from: 2, to: 3 }],
  violations: [],
});
const scheduleResponse = (
  mode: "preview" | "confirmed",
  result: unknown,
  extra: Record<string, unknown> = {},
) => ({
  ok: true,
  mode,
  request_id: null,
  replayed: false,
  result,
  error: null,
  ...extra,
});

const zeroMetric = (reason: string) => ({ value: null, reason });
const metrics = (consent: boolean) => ({
  workout_id: RUN,
  workout_date_local: TODAY,
  distance_m: { value: 8200, reason: null },
  distance_estimated: false,
  timer_s: { value: 2712, reason: null },
  pace_s_per_km: { value: 331, reason: null },
  kilometre_times_s: { value: [335, 330, 329, 332], reason: null },
  best_efforts: {
    "1k": { value: { time_s: 322, start_m: 4000 }, reason: null },
    "5k": { value: { time_s: 1640, start_m: 1000 }, reason: null },
    "10k": zeroMetric("distance_not_covered"),
    half_marathon: zeroMetric("distance_not_covered"),
  },
  segments: [],
  work_share_in_target: zeroMetric("no_target"),
  fulfilment: { value: 0.9, reason: null },
  zones: consent
    ? {
        value: {
          seconds: [300, 1900, 400, 112, 0],
          total_s: 2712,
          share: [0.11, 0.7, 0.15, 0.04, 0],
        },
        reason: null,
      }
    : zeroMetric("hr_no_consent"),
  load: {
    srpe: { value: 181, reason: null },
    edwards: consent
      ? { value: 150, reason: null }
      : zeroMetric("hr_no_consent"),
    primary: { value: { basis: "srpe", value: 181 }, reason: null },
  },
  decoupling: zeroMetric("shorter_than_45_min"),
});
const analysisRun = (consent = false) => ({
  view: "run",
  reference_date: TODAY,
  run: {
    view: consent
      ? doneView({
          result: {
            ...doneView().result,
            hr_status: "recorded",
            hr_avg_bpm: 139,
            hr_max_bpm: 158,
          },
        })
      : doneView(),
    metrics: metrics(consent),
  },
  weeks: [],
  load_ratio: null,
  notes: [],
});
const sum = (value: number | null, known: number, total: number) => ({
  value,
  known,
  total,
  reason: value === null ? "no_run_time" : known < total ? "rpe_missing" : null,
});
const statsWeek = (
  n: number,
  count: number,
  distance = sum(count ? count * 8000 : null, count, count),
) => ({
  week_start: `2026-${n < 3 ? "10" : "11"}-${String([5, 12, 19, 26][n] ?? 2).padStart(2, "0")}`,
  week_end: `2026-${n < 3 ? "10" : "11"}-${String([11, 18, 25, 1][n] ?? 8).padStart(2, "0")}`,
  running: {
    run_count: count,
    distance_m: distance,
    timer_s: sum(count ? count * 2700 : null, count, count),
    pace_s_per_km: count
      ? { value: 335, reason: null }
      : zeroMetric("no_pace_data"),
    long_run_share: zeroMetric("no_runs"),
    intensity: {
      basis: count ? "mixed" : null,
      share: count
        ? { value: { low: 0.8, moderate: 0.1, high: 0.1 }, reason: null }
        : zeroMetric("no_runs"),
    },
    fulfilment: {
      planned: count,
      completed: count,
      missed: 0,
      open: 0,
      rate: count ? { value: 1, reason: null } : zeroMetric("nothing_due"),
    },
  },
  strength: { workouts: 2, working_sets: 24 },
});
const stats = (loadRatio: unknown) => ({
  view: "four_weeks",
  reference_date: TODAY,
  run: null,
  weeks: [
    statsWeek(0, 3),
    statsWeek(1, 0),
    statsWeek(2, 4, sum(25000, 3, 4)),
    statsWeek(3, 2),
  ],
  load_ratio: loadRatio,
  notes: [],
});
const profile = (over: Record<string, unknown> = {}) => ({
  run_profile_id: "rp-1",
  row_revision: 2,
  goal: "10k",
  race_date: null,
  target_time_s: null,
  reference: null,
  running_experience_months: null,
  runs_per_week: 3,
  long_run_weekday: null,
  preferred_environment: "outdoor",
  base_minutes_per_week: null,
  longest_run_4w_min: null,
  alarm_settings: null,
  ...over,
});
const derived = {
  experience: "beginner",
  reference_valid: false,
  reference_reason: "reference_missing",
  reference_valid_until: null,
  vdot: null,
  pace_zones: null,
};
const writeOk = (operation: string, over: Record<string, unknown> = {}) => ({
  ok: true,
  operation,
  request_id: "echo",
  replayed: false,
  result: {
    profile: null,
    run: null,
    replaced_workout_id: null,
    rationale: [],
    warnings: [],
    hr_discarded: false,
    ...over,
  },
  error: null,
});

/* --------------------------------------------------------------- helpers */

const ok = (route: Route, value: unknown, isError = false, meta?: object) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: route.request().postDataJSON().id,
      result: {
        content: [],
        ...(value === undefined ? {} : { structuredContent: value }),
        ...(meta ? { _meta: meta } : {}),
        ...(isError ? { isError } : {}),
      },
    }),
  });

/** Answers the run tools; every call is recorded. */
async function mockRun(page: Page, card: string, handlers: Handlers) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const counts: Record<string, number> = {};
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.method !== "tools/call") return route.continue();
    const tool = body.params.name as string;
    const args = (body.params.arguments ?? {}) as Record<string, unknown>;
    if (tool === "show_arnold_run")
      return ok(route, {
        run_card_contract: "arnold.run_card/1",
        card,
        workout_id: args.workout_id ?? null,
      });
    const handler = handlers[tool];
    if (!handler) return route.continue();
    calls.push({ tool, args });
    counts[tool] = (counts[tool] ?? 0) + 1;
    const out = handler(args, counts[tool]);
    if (!out)
      return ok(route, undefined, true, {
        arnold: {
          code: "UNAVAILABLE",
          retryable: true,
          recovery: "retry_same_request",
        },
      });
    return ok(route, out.value, out.isError, out.meta);
  });
  return calls;
}

const main = (page: Page, card: string) =>
  page.locator(`main[data-card="${card}"]`);

async function open(page: Page, card: string, workout?: string) {
  await page.goto(
    `${BASE}/preview?run=${card}${workout ? `&workout_id=${workout}` : ""}`,
  );
  await expect(main(page, card)).toBeVisible();
}

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: `${SHOTS}/run-${name}.png`,
    fullPage: true,
  });
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const ZERO_WRITE_PLACEHOLDER = /\b0 (km|Min\.)|0:00/;

/* ----------------------------------------------------------------- cards */

const CARDS: {
  card: string;
  handlers: () => Handlers;
  heading: string;
  text: RegExp;
}[] = [
  {
    card: "run_today",
    heading: "Lockerer Dauerlauf",
    text: /45 Min\./,
    handlers: () => ({
      get_run_week: () => ({ value: week() }),
      get_run_analysis: () => ({
        value: { ...analysisRun(), run: { view: view(), metrics: {} } },
      }),
    }),
  },
  {
    card: "run_result",
    heading: "Lockerer Dauerlauf",
    text: /8,2 km/,
    handlers: () => ({
      get_run_week: () => ({ value: week() }),
      get_run_analysis: () => ({ value: analysisRun() }),
    }),
  },
  {
    card: "run_week",
    heading: "9. Nov. bis 15. November 2026",
    text: /Läufe 1 von 3 erledigt/,
    handlers: () => ({ get_run_week: () => ({ value: week() }) }),
  },
  {
    card: "run_stats",
    heading: "Die letzten vier Wochen",
    text: /aus 3 von 4 Läufen/,
    handlers: () => ({
      get_run_analysis: () => ({
        value: stats({
          value: {
            ratio: 1.12,
            acute: 300,
            chronic_weekly: 268,
            basis: "srpe",
            known_runs: 5,
            total_runs: 6,
          },
          reason: null,
        }),
      }),
    }),
  },
  {
    card: "run_setup",
    heading: "Dein Laufprofil",
    text: /Läufe pro Woche/,
    handlers: () => ({
      get_run_profile: () => ({
        value: {
          profile: profile(),
          derived,
          missing: [
            "running_experience_months",
            "reference (Test, Wettkampf oder eigene Angabe)",
          ],
        },
      }),
    }),
  },
];

for (const theme of ["light", "dark"] as const)
  for (const spec of CARDS)
    test(`${spec.card} shows its own numbers (${theme}, 375 px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await mockRun(page, spec.card, spec.handlers());
      await open(page, spec.card);
      const card = main(page, spec.card);
      await expect(
        card.getByRole("heading", { name: spec.heading }),
      ).toBeVisible();
      await expect(card).toContainText(spec.text);
      await noOverflow(page);
      const axe = await new AxeBuilder({ page })
        .include(`main[data-card="${spec.card}"]`)
        .analyze();
      expect(
        axe.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        ),
      ).toEqual([]);
      await shot(page, `${spec.card}-${theme}`);
    });

/* ------------------------------------------------------------- run_today */

test("run_today: Kürzer saves the minutes the user chose", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const calls = await mockRun(page, "run_today", {
    get_run_week: () => ({ value: week() }),
    get_run_analysis: () => ({
      value: { ...analysisRun(), run: { view: view(), metrics: {} } },
    }),
    update_planned_run: () => ({
      value: writeOk("update_planned_run", { run: view() }),
    }),
  });
  await open(page, "run_today");
  const card = main(page, "run_today");
  await card.getByRole("button", { name: "Kürzer", exact: true }).click();
  // The save button stays off until the user picks fewer minutes than planned.
  const save = card.getByRole("button", { name: "Kürzer speichern" });
  await expect(save).toBeDisabled();
  await card.getByRole("button", { name: /Neue Dauer weniger/ }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(card).toContainText("Gekürzt und gespeichert.");
  const sent = calls.find((c) => c.tool === "update_planned_run")!.args;
  expect(sent).toMatchObject({
    workout_id: RUN,
    expected_row_revision: 3,
    run_type: "base",
    minutes: 40,
  });
  expect(typeof sent.request_id).toBe("string");
});

test("run_today: no planned run shows an empty state without numbers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const empty = {
    ...week(),
    days: week().days.map((d) => ({ ...d, runs: [] })),
  };
  await mockRun(page, "run_today", { get_run_week: () => ({ value: empty }) });
  await open(page, "run_today");
  const card = main(page, "run_today");
  await expect(card).toContainText("Heute ist kein Lauf geplant");
  await expect(card).not.toContainText(/\d+ Min\./);
});

/* -------------------------------------------------------------- run_week */

test("run_week: the preview saves nothing; confirm sends the preview's hash and one request id", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const calls = await mockRun(page, "run_week", {
    get_run_week: () => ({ value: week() }),
    schedule_run_week: (args) =>
      args.confirm
        ? {
            value: scheduleResponse("confirmed", preview("hash-a"), {
              request_id: args.request_id,
            }),
          }
        : { value: scheduleResponse("preview", preview("hash-a")) },
  });
  await open(page, "run_week");
  const card = main(page, "run_week");
  await card.getByRole("button", { name: "Nächste Woche planen" }).click();
  await expect(card).toContainText("Noch nichts gespeichert.");
  await expect(card).toContainText("Vorschlag");
  await expect(card).toContainText("Dauerlauf: Stufe 2 → 3");
  await expect(card).toContainText(
    "Nicht eingeplant – Tempodauerlauf: zu wenig freie Tage",
  );
  expect(calls.filter((c) => c.args.confirm)).toHaveLength(0);
  await shot(page, "run_week-preview");
  await card.getByRole("button", { name: "Woche bestätigen" }).click();
  await expect(card).toContainText("Gespeichert. Die Woche ist geplant.");
  const confirm = calls.filter((c) => c.args.confirm)[0].args;
  expect(confirm.preview_hash).toBe("hash-a");
  expect(typeof confirm.request_id).toBe("string");
});

test("run_week: a failed confirm keeps the request id, CONFIRMATION_REQUIRED asks for a new preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let previews = 0;
  const calls = await mockRun(page, "run_week", {
    get_run_week: () => ({ value: week() }),
    schedule_run_week: (args, call) => {
      if (!args.confirm) {
        previews += 1;
        return {
          value: scheduleResponse(
            "preview",
            preview(previews === 1 ? "hash-a" : "hash-b"),
          ),
        };
      }
      // 1st confirm: connection problem (unclear). 2nd: the week changed.
      if (call === 2) return undefined;
      return {
        isError: true,
        value: {
          ok: false,
          mode: "confirmed",
          request_id: null,
          replayed: false,
          result: null,
          error: {
            code: "CONFIRMATION_REQUIRED",
            message: "Die Woche hat sich geändert.",
            retryable: false,
            details: [],
            recovery: "start_over",
          },
        },
      };
    },
  });
  await open(page, "run_week");
  const card = main(page, "run_week");
  await card.getByRole("button", { name: "Nächste Woche planen" }).click();
  const confirmButton = card.getByRole("button", { name: "Woche bestätigen" });
  await confirmButton.click();
  // Unclear failure: same preview, same request id on the retry.
  await expect(card).toContainText("Deine Vorschau bleibt erhalten");
  await confirmButton.click();
  await expect(card).toContainText("Die Woche hat sich geändert.");
  const confirms = calls.filter((c) => c.args.confirm).map((c) => c.args);
  expect(confirms).toHaveLength(2);
  expect(confirms[1].request_id).toBe(confirms[0].request_id);
  // A new preview (new hash) replaced it; a new confirm uses a new request id.
  expect(previews).toBe(2);
  await confirmButton.click();
  await expect.poll(() => calls.filter((c) => c.args.confirm).length).toBe(3);
  const third = calls.filter((c) => c.args.confirm)[2].args;
  expect(third.preview_hash).toBe("hash-b");
  expect(third.request_id).not.toBe(confirms[0].request_id);
});

/* ------------------------------------------------------------ run_result */

test("run_result without health consent: Zone 2 laut Uhr, no heart-rate numbers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockRun(page, "run_result", {
    get_run_analysis: () => ({ value: analysisRun(false) }),
  });
  await open(page, "run_result", RUN);
  const card = main(page, "run_result");
  await expect(card).toContainText("Zone 2 laut Uhr");
  await expect(card.getByTestId("zones-unknown")).toContainText(
    "Ohne deine Einwilligung für Gesundheitsdaten nutzt Arnold keinen Puls.",
  );
  await expect(
    card.getByRole("list", { name: "Zeit in den Pulszonen" }),
  ).toHaveCount(0);
  await expect(
    card.locator(".ac-rows li").filter({ hasText: "Puls Ø" }),
  ).toContainText("–");
  await expect(
    card.locator(".ac-rows li").filter({ hasText: "Belastung" }),
  ).toContainText("181");
  await shot(page, "run_result-no-consent");
});

test("run_result with heart rate shows the zones Arnold delivered", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockRun(page, "run_result", {
    get_run_analysis: () => ({ value: analysisRun(true) }),
  });
  await open(page, "run_result", RUN);
  const zones = main(page, "run_result").getByRole("list", {
    name: "Zeit in den Pulszonen",
  });
  await expect(zones.locator("li")).toHaveCount(5);
  await expect(zones.locator("li").nth(1)).toContainText("31:40 · 70 %");
});

test("run_result without any finished run shows no figures", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockRun(page, "run_result", {
    get_run_week: () => ({
      value: { ...week(), days: week().days.map((d) => ({ ...d, runs: [] })) },
    }),
  });
  await open(page, "run_result");
  const card = main(page, "run_result");
  await expect(card).toContainText("Noch kein Lauf gelaufen");
  await expect(card).not.toContainText(ZERO_WRITE_PLACEHOLDER);
});

/* ------------------------------------------------------------- run_stats */

test("run_stats: 7:28 unknown with its reason, weeks without runs show no figures", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockRun(page, "run_stats", {
    get_run_analysis: () => ({
      value: stats({ value: null, reason: "history_too_short" }),
    }),
  });
  await open(page, "run_stats");
  const card = main(page, "run_stats");
  await expect(
    card.locator(".ac-rows li").filter({ hasText: "Belastung 7 : 28 Tage" }),
  ).toContainText("Noch zu wenige Tage Verlauf");
  const empty = card.locator("section.run-week-block").nth(1);
  await expect(empty).toContainText("Keine Läufe gelaufen.");
  await expect(empty).not.toContainText(/km|Tempo/);
  // A sum fed by 3 of 4 runs says so; the number is the server's.
  await expect(card).toContainText("25,0 km aus 3 von 4 Läufen");
  await expect(
    card.locator(".ac-rows li").filter({ hasText: "Belastung 7 : 28 Tage" }),
  ).not.toContainText("aus");
  await shot(page, "run_stats-ratio-unknown");
});

test("run_stats: the 7:28 ratio says aus x von y Läufen when only some had a load", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockRun(page, "run_stats", {
    get_run_analysis: () => ({
      value: stats({
        value: {
          ratio: 1.12,
          acute: 300,
          chronic_weekly: 268,
          basis: "srpe",
          known_runs: 5,
          total_runs: 6,
        },
        reason: null,
      }),
    }),
  });
  await open(page, "run_stats");
  await expect(
    main(page, "run_stats")
      .locator(".ac-rows li")
      .filter({ hasText: "Belastung 7 : 28 Tage" }),
  ).toContainText("1,12 aus 5 von 6 Läufen");
});

/* ------------------------------------------------------------- run_setup */

test("run_setup: creating a profile sends only the user's answers with one request id", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const calls = await mockRun(page, "run_setup", {
    get_run_profile: () => ({
      value: { profile: null, derived, missing: ["run_profile"] },
    }),
    update_run_profile: () => ({
      value: writeOk("update_run_profile", { profile: profile() }),
    }),
  });
  await open(page, "run_setup");
  const card = main(page, "run_setup");
  await expect(
    card.getByRole("heading", { name: "Laufen einrichten" }),
  ).toBeVisible();
  const save = card.getByRole("button", { name: "Speichern" });
  await expect(save).toBeDisabled();
  await card.getByRole("button", { name: "10 km" }).click();
  await card.getByRole("button", { name: /Läufe pro Woche mehr/ }).click();
  await save.click();
  await expect(card).toContainText("Gespeichert.");
  const sent = calls.find((c) => c.tool === "update_run_profile")!.args;
  expect(sent).toMatchObject({
    goal: "10k",
    runs_per_week: 4,
    preferred_environment: "outdoor",
  });
  expect(sent.expected_row_revision).toBeUndefined();
  expect(sent.running_experience_months).toBeUndefined();
  expect(typeof sent.request_id).toBe("string");
});

/* --------------------------------------------------- empty and failed reads */

for (const spec of CARDS)
  test(`${spec.card}: a failed read shows a notice and no figures`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const failing: Handlers = {};
    for (const tool of Object.keys(spec.handlers()))
      failing[tool] = () => undefined;
    await mockRun(page, spec.card, failing);
    await page.goto(`${BASE}/preview?run=${spec.card}`);
    const body = page.locator("main#main-content");
    await expect(body.getByRole("button").first()).toBeVisible();
    const text = (await body.innerText()).replace(/\s+/g, " ");
    expect(text).not.toMatch(/\d/);
    await expect(page.locator(`main[data-card="${spec.card}"]`)).toHaveCount(0);
    await shot(page, `${spec.card}-failed`);
  });

for (const spec of CARDS)
  test(`${spec.card}: an empty answer shows a notice and no figures`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const empty: Handlers = {};
    for (const tool of Object.keys(spec.handlers()))
      empty[tool] = () => ({ value: undefined });
    await mockRun(page, spec.card, empty);
    await page.goto(`${BASE}/preview?run=${spec.card}`);
    const body = page.locator("main#main-content");
    await expect(body.getByRole("button").first()).toBeVisible();
    expect((await body.innerText()).replace(/\s+/g, " ")).not.toMatch(/\d/);
  });
