import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { callTool } from "./helpers";
import type { ArnoldDashboardView } from "../../src/shared/arnold-view";
import { berlinToday } from "../fixtures/berlin-today";

/**
 * The recap after a workout (UX-006): "Geschafft: …" at the top of the
 * overview, once, only for a real new workout, with at most one suggestion
 * for next time as information. Both buttons only mark it as seen. A writable
 * synthetic tracker per browser project; every test saves its own workout.
 */
const baseFor = (project: string) =>
  project === "webkit" ? "http://127.0.0.1:8833" : "http://127.0.0.1:8832";
const today = () => berlinToday();
let n = 0;

/** A completed workout from the plan's proposal, so there is something new. */
async function newWorkout(page: Page) {
  const saved = (await callTool(page, "log_workout", {
    request_id: `ux006-${Date.now()}-${n++}`,
    workout_date_local: today(),
    timezone: "Europe/Berlin",
    session_id: "pfx-s-push",
    confirm_duplicate: true,
    source: "ui",
  })) as { ok: boolean; result: { workout: { workout_id: string } } };
  expect(saved.ok).toBe(true);
  return saved.result.workout.workout_id;
}
const dashboard = (page: Page) =>
  callTool(page, "show_arnold_dashboard") as Promise<ArnoldDashboardView>;
const banner = (page: Page) =>
  page.getByRole("region", { name: "Rückblick auf dein Training" });

async function open(page: Page, base: string) {
  await page.goto(`${base}/preview?card=home`);
  await expect(page.locator('main[data-card="home"]')).toBeVisible();
}

test("shows what the server delivers, and nothing else", async ({
  page,
}, info) => {
  const base = baseFor(info.project.name);
  await page.goto(`${base}/preview?card=home`);
  const workoutId = await newWorkout(page);
  const view = await dashboard(page);
  const recap = view.recap!;
  expect(recap.workout_id).toBe(workoutId);
  await open(page, base);
  await expect(banner(page)).toBeVisible();
  await expect(banner(page).getByRole("heading")).toContainText(
    `Geschafft: ${recap.title}`,
  );
  // One line per record of the server, none invented.
  await expect(banner(page).locator(".cc-line.ok")).toHaveCount(
    recap.records.length + (recap.week_goal ? 1 : 0),
  );
  for (const r of recap.records)
    await expect(banner(page)).toContainText(
      `Neuer Rekord: ${r.exercise_name}`,
    );
  if (recap.suggestion)
    await expect(banner(page)).toContainText(
      `Nächstes Mal: ${recap.suggestion.exercise_name}`,
    );
  else await expect(banner(page)).not.toContainText("Nächstes Mal");
  // The suggestion is information: nothing is offered that is not saved.
  await expect(banner(page)).not.toContainText(/Übernehmen|So lassen/);
});

test("Verstanden marks it as seen: gone now and on every later open", async ({
  page,
}, info) => {
  const base = baseFor(info.project.name);
  await page.goto(`${base}/preview?card=home`);
  await newWorkout(page);
  await open(page, base);
  await banner(page).getByRole("button", { name: "Verstanden" }).click();
  await expect(banner(page)).toHaveCount(0);
  await expect
    .poll(async () => (await dashboard(page)).recap ?? null)
    .toBeNull();
  await open(page, base);
  await expect(banner(page)).toHaveCount(0);
  // No new workout, no recap: still nothing after another look.
  await open(page, base);
  await expect(banner(page)).toHaveCount(0);
});

test("Nächstes Training ansehen opens today and marks it as seen", async ({
  page,
}, info) => {
  const base = baseFor(info.project.name);
  await page.goto(`${base}/preview?card=home`);
  await newWorkout(page);
  const view = await dashboard(page);
  test.skip(!view.recap?.suggestion, "the server delivered no suggestion");
  await open(page, base);
  await banner(page)
    .getByRole("button", { name: "Nächstes Training ansehen" })
    .click();
  await expect(page.locator("main")).toHaveAttribute("data-card", "today");
  await expect
    .poll(async () => (await dashboard(page)).recap ?? null)
    .toBeNull();
  await open(page, base);
  await expect(banner(page)).toHaveCount(0);
});

test("a second newer workout brings a new recap, the seen one stays gone", async ({
  page,
}, info) => {
  const base = baseFor(info.project.name);
  await page.goto(`${base}/preview?card=home`);
  const first = await newWorkout(page);
  expect((await dashboard(page)).recap?.workout_id).toBe(first);
  await callTool(page, "mark_recap_seen", { workout_id: first });
  expect((await dashboard(page)).recap ?? null).toBeNull();
  const second = await newWorkout(page);
  expect((await dashboard(page)).recap?.workout_id).toBe(second);
});

/** A finished run of today, as the user would report it in chat. */
async function newRun(page: Page) {
  const saved = (await callTool(page, "log_run", {
    request_id: `ux014-${Date.now()}-${n++}`,
    timezone: "Europe/Berlin",
    workout_date_local: today(),
    environment: "outdoor",
    run_type: "base",
    timer_s: 2700,
    distance_m: 7000,
    confirm_duplicate: true,
  })) as { ok: boolean; result: { run: { workout_id: string } } };
  expect(saved.ok, JSON.stringify(saved)).toBe(true);
  return saved.result.run.workout_id;
}
const runBanner = (page: Page) =>
  page.getByRole("region", { name: "Rückblick auf deinen Lauf" });

test("a new run shows distance, time and pace, once, without a suggestion", async ({
  page,
}, info) => {
  const base = baseFor(info.project.name);
  await page.goto(`${base}/preview?card=home`);
  const runId = await newRun(page);
  const recap = (await dashboard(page)).recap!;
  expect(recap).toMatchObject({ kind: "run", workout_id: runId });
  await open(page, base);
  await expect(runBanner(page)).toBeVisible();
  await expect(runBanner(page)).toContainText("7 km");
  await expect(runBanner(page)).toContainText("45:00");
  await expect(runBanner(page)).toContainText("6:26 /km");
  await expect(runBanner(page)).not.toContainText(
    /Nächstes|Übung|Rekord|Arbeitssätze/,
  );
  await runBanner(page).getByRole("button", { name: "Verstanden" }).click();
  await expect(runBanner(page)).toHaveCount(0);
  await expect
    .poll(async () => (await dashboard(page)).recap ?? null)
    .toBeNull();
  await open(page, base);
  await expect(runBanner(page)).toHaveCount(0);
});

test("a newer run beats an older workout; the workout stays unseen", async ({
  page,
}, info) => {
  const base = baseFor(info.project.name);
  await page.goto(`${base}/preview?card=home`);
  const workoutId = await newWorkout(page);
  const runId = await newRun(page);
  expect((await dashboard(page)).recap?.workout_id).toBe(runId);
  await callTool(page, "mark_recap_seen", { workout_id: runId });
  // Only the younger one is the recap; the workout got no receipt (not seen).
  expect((await dashboard(page)).recap ?? null).toBeNull();
  const marked = (await callTool(page, "mark_recap_seen", {
    workout_id: workoutId,
  })) as { ok: boolean; replayed: boolean };
  expect(marked).toMatchObject({ ok: true, replayed: false });
});

for (const scheme of ["light", "dark"] as const)
  test(`no violations and no sideways scroll at 375 px, ${scheme}`, async ({
    page,
  }, info) => {
    const base = baseFor(info.project.name);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${base}/preview?card=home`);
    await newWorkout(page);
    await open(page, base);
    await expect(banner(page)).toBeVisible();
    await expectClean(page);
  });

for (const scheme of ["light", "dark"] as const)
  test(`run recap: no violations, no sideways scroll at 375 px, ${scheme}`, async ({
    page,
  }, info) => {
    const base = baseFor(info.project.name);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${base}/preview?card=home`);
    await newRun(page);
    await open(page, base);
    await expect(runBanner(page)).toBeVisible();
    await expectClean(page);
    if (info.project.name === "chromium" && process.env.UX014_SHOTS) {
      const dir = join(
        homedir(),
        "Library/Application Support/Claude/side-session-notes/arn-ux",
      );
      mkdirSync(dir, { recursive: true });
      await page.setViewportSize({ width: 420, height: 900 });
      await page.locator("main").screenshot({
        path: join(dir, `UX-014-${scheme === "light" ? "hell" : "dunkel"}.png`),
      });
    }
  });

async function expectClean(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
