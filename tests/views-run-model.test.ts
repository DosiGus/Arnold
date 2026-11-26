/**
 * The run cards (src/views/model/run.ts) against the real tools: today's run
 * with "Kürzer" and "Verschieben", the result, the week with its preview, the
 * stats and the profile. Unknown is "–" with a reason, never 0.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RunAnalysisResponseSchema,
  RunProfileResponseSchema,
  RunWeekResponseSchema,
  RunWriteResponseSchema,
  ScheduleRunWeekResponseSchema,
} from "../src/shared/run-contract";
import {
  lastCompletedRun,
  moveInput,
  previewModel,
  runDraft,
  runProfileInput,
  runResultModel,
  runStatsModel,
  runTodayModel,
  shortenInput,
  shorterChoices,
  upcomingRun,
  weekDays,
  weekHeading,
} from "../src/views/model/run";
import { berlinToday } from "./fixtures/berlin-today";
import { cardServer, type CardServer } from "./fixtures/views-cards";

const TZ = "Europe/Berlin";
let server: CardServer;
beforeEach(async () => {
  server = await cardServer();
});
afterEach(() => server.close());

const week = () =>
  server.read("get_run_week", RunWeekResponseSchema, { timezone: TZ });
const analysis = (args: Record<string, unknown>) =>
  server.read("get_run_analysis", RunAnalysisResponseSchema, {
    timezone: TZ,
    ...args,
  });
const planRun = () =>
  server.read("plan_run", RunWriteResponseSchema, {
    request_id: randomUUID(),
    timezone: TZ,
    run_type: "base",
    minutes: 40,
  });

async function todayModel() {
  const w = await week();
  const run = upcomingRun(w)!;
  return runTodayModel(
    await analysis({ view: "run", workout_id: run.workout_id }),
    w,
    run.level,
    run.changed,
  )!;
}

describe("today", () => {
  it("has no run when nothing is planned", async () => {
    expect(upcomingRun(await week())).toBeNull();
  });

  it("shows today's run, shortens it and moves it", async () => {
    await planRun();
    const m = await todayModel();
    expect(m).toMatchObject({ heading: "Heutiger Lauf", canChange: true });
    expect(m.plannedMinutes).toBeGreaterThan(0);
    const shorter = shorterChoices(m.plannedMinutes!)[0]!;
    expect(shorter).toBeLessThan(m.plannedMinutes!);
    const done = await server.read(
      "update_planned_run",
      RunWriteResponseSchema,
      shortenInput(m, shorter, randomUUID()),
    );
    expect(done.ok).toBe(true);
    const next = await todayModel();
    const tomorrow = new Date(`${berlinToday()}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const moved = await server.read(
      "update_planned_run",
      RunWriteResponseSchema,
      moveInput(next, tomorrow.toISOString().slice(0, 10), TZ, randomUUID()),
    );
    expect(moved.ok).toBe(true);
  });

  it("offers only shorter lengths", () => {
    expect(shorterChoices(22)).toEqual([20, 15, 10, 5]);
    expect(shorterChoices(5)).toEqual([]);
  });
});

describe("result, week and stats", () => {
  it("shows a logged run; what Arnold does not know stays unknown", async () => {
    await server.read("log_run", RunWriteResponseSchema, {
      request_id: randomUUID(),
      timezone: TZ,
      workout_date_local: berlinToday(),
      timer_s: 1800,
      distance_m: 5000,
      environment: "outdoor",
    });
    const id = lastCompletedRun(await week())!;
    const m = runResultModel(await analysis({ view: "run", workout_id: id }))!;
    const row = (key: string) => m.rows.find((r) => r.key === key)!;
    expect(m.completed).toBe(true);
    expect(row("distance_m").value).toBe("5 km");
    expect(row("timer_s").value).toBe("30:00");
    expect(row("pace_s_per_km").value).toBe("6:00 /km");
    expect(row("rpe").value).toBe("–");
    expect(row("hr").value).toBe("–");
    expect(m.zonesNote).toContain("Pulszonen");

    const head = weekHeading(await week());
    expect(head.subtitle).toContain("Läufe");
    const today = weekDays((await week()).days).find((d) => d.today)!;
    expect(today.items[0]).toMatchObject({ resultId: id, status: "Gelaufen" });

    const stats = runStatsModel(await analysis({ view: "four_weeks" }));
    expect(stats.ratio.value).toBe("–");
    expect(stats.ratio.note).toBeTruthy();
    expect(stats.weeks.at(-1)!.rows.map((r) => r.key)).toContain("distance_m");
  });

  it("has no result for a run that was not run", async () => {
    await planRun();
    const run = upcomingRun(await week())!;
    const m = runResultModel(
      await analysis({ view: "run", workout_id: run.workout_id }),
    )!;
    expect(m).toMatchObject({ completed: false, rows: [] });
  });

  it("previews a week without saving it", async () => {
    await server.read("update_run_profile", RunWriteResponseSchema, {
      request_id: randomUUID(),
      goal: "fitness",
      runs_per_week: 3,
      preferred_environment: "outdoor",
    });
    const out = await server.raw("schedule_run_week", { timezone: TZ });
    const parsed = ScheduleRunWeekResponseSchema.parse(out.structuredContent);
    if (parsed.result) {
      const p = previewModel(parsed.result);
      expect(p.subtitle).toBe("Noch nichts gespeichert.");
      expect(p.days.flatMap((d) => d.items).every((i) => !i.resultId)).toBe(
        true,
      );
    } else expect(parsed.error).toBeTruthy();
  });
});

describe("profile", () => {
  it("creates one only from chosen answers, then sends only changes", async () => {
    expect(runProfileInput(null, runDraft(null))).toEqual({
      ok: false,
      hint: null,
    });
    const built = runProfileInput(null, {
      ...runDraft(null),
      goal: "5k",
      perWeek: 2,
      environment: "track",
    });
    if (!built.ok) throw new Error("not built");
    expect(built.input).toEqual({
      goal: "5k",
      runs_per_week: 2,
      preferred_environment: "track",
    });
    await server.read("update_run_profile", RunWriteResponseSchema, {
      ...built.input,
      request_id: randomUUID(),
    });
    const stored = (
      await server.read("get_run_profile", RunProfileResponseSchema)
    ).profile!;
    expect(runProfileInput(stored, runDraft(stored))).toEqual({
      ok: false,
      hint: null,
    });
    expect(
      runProfileInput(stored, { ...runDraft(stored), months: "12" }),
    ).toEqual({
      ok: true,
      input: {
        running_experience_months: 12,
        expected_row_revision: stored.row_revision,
      },
    });
    expect(
      runProfileInput(stored, { ...runDraft(stored), months: "x" }),
    ).toMatchObject({ ok: false, hint: expect.stringContaining("1200") });
  });
});
