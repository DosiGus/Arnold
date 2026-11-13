import { describe, expect, it } from "vitest";
import { addDays } from "../src/analytics/period.js";
import { HARD_RUN_TYPES } from "../src/shared/run-contract.js";
import {
  scheduleRunWeek,
  weekdayOf,
  type ScheduleRunWeekInput,
  type StrengthDay,
} from "../src/analytics/running/index.js";
import {
  TODAY,
  profile,
  run,
  scheduleInput,
  session,
  steadyHistory,
  typicalSessions,
} from "./analytics-running-week-helpers.js";

const d = (offset: number) => addDays(TODAY, offset);
/** Two steady weeks (no deload): the week is open for planning. */
const HISTORY = steadyHistory(2, 40);
const input = (over: Partial<ScheduleRunWeekInput> = {}) =>
  scheduleInput({ history: HISTORY, ...over });
const hardRuns = (schedule: ReturnType<typeof scheduleRunWeek>) =>
  schedule.runs.filter((r) => HARD_RUN_TYPES.includes(r.run_type));

describe("scheduleRunWeek", () => {
  it("plans a typical week without breaking a rule, one run per day", () => {
    const schedule = scheduleRunWeek(input());
    expect(schedule.check.violations).toEqual([]);
    expect(schedule.runs.length).toBeGreaterThanOrEqual(3);
    const dates = schedule.runs.map((r) => r.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(schedule.days).toHaveLength(7);
    expect(schedule.days.map((x) => x.date)).toEqual(schedule.context.window);
    expect(schedule.runs.length + schedule.dropped.length).toBe(4);
    const total = schedule.runs.reduce((sum, r) => sum + r.minutes, 0);
    expect(total).toBeLessThanOrEqual(schedule.context.volume.minutes);
  });

  it("puts the long run on the long run weekday when the rules allow it", () => {
    const weekday = weekdayOf(d(5));
    const schedule = scheduleRunWeek(
      input({
        profile: profile({ long_run_weekday: weekday }),
        history: steadyHistory(2, 75),
        sessions: [
          session(1, "base", [60, 75]),
          session(2, "base", [60, 75]),
          session(3, "base", [60, 75]),
          session(4, "long", [75, 90]),
        ],
      }),
    );
    const long = schedule.runs.find((r) => r.run_type === "long");
    expect(long?.date).toBe(d(5));
  });

  it("turns hard sessions beyond the allowed number into easy runs, with a hint", () => {
    const sessions = [
      session(1, "tempo", [30, 50]),
      session(2, "intervals", [30, 50]),
      session(3, "hills", [30, 50]),
      session(4, "base", [30, 45]),
    ];
    const schedule = scheduleRunWeek(input({ sessions }));
    expect(hardRuns(schedule).length).toBeLessThanOrEqual(2);
    expect(schedule.notes.map((n) => n.code)).toContain("session_converted");
    expect(schedule.check.violations).toEqual([]);
  });

  it("allows only strides instead of hard runs in the first weeks of a beginner", () => {
    const schedule = scheduleRunWeek(
      input({
        profile: profile({
          running_experience_months: 0,
          base_minutes_per_week: null,
        }),
        history: [],
        sessions: [session(1, "tempo", [20, 30]), session(2, "base", [20, 30])],
      }),
    );
    expect(schedule.context.beginner_first_weeks).toBe(true);
    expect(hardRuns(schedule)).toEqual([]);
    expect(schedule.runs.map((r) => r.run_type)).toContain("strides");
    expect(schedule.check.violations).toEqual([]);
  });

  it("drops sessions that do not fit into the runs per week, and says so", () => {
    const schedule = scheduleRunWeek(
      input({ profile: profile({ runs_per_week: 2 }) }),
    );
    expect(schedule.runs).toHaveLength(2);
    expect(schedule.dropped).toHaveLength(2);
    expect(
      schedule.notes.filter((n) => n.code === "session_dropped"),
    ).toHaveLength(2);
  });

  it("plans nothing on race day and no hard run the day before", () => {
    const schedule = scheduleRunWeek(
      input({ profile: profile({ goal: "10k", race_date: d(3) }) }),
    );
    expect(schedule.runs.map((r) => r.date)).not.toContain(d(3));
    expect(
      schedule.runs.filter(
        (r) => r.date === d(2) && HARD_RUN_TYPES.includes(r.run_type),
      ),
    ).toEqual([]);
    expect(schedule.check.violations).toEqual([]);
    expect(schedule.notes.map((n) => n.code)).toContain("race_day");
  });

  it("keeps hard runs off the day after a heavy leg day and hints for the same day", () => {
    const heavy: StrengthDay[] = [1, 3, 5].map((offset) => ({
      date: d(offset),
      leg_sets: 8,
      heavy_legs: true,
      planned: offset > 0,
    }));
    const schedule = scheduleRunWeek(input({ strength_days: heavy }));
    for (const r of hardRuns(schedule))
      expect(heavy.map((x) => x.date)).not.toContain(addDays(r.date, -1));
    expect(schedule.check.violations).toEqual([]);
    expect(schedule.days.find((x) => x.date === d(1))?.strength).toEqual({
      heavy_legs: true,
    });
  });

  it("limits the hard runs to one when strength is the main goal", () => {
    const schedule = scheduleRunWeek(input({ focus: "strength" }));
    expect(schedule.context.max_hard).toBe(1);
    expect(hardRuns(schedule).length).toBeLessThanOrEqual(1);
  });

  it("keeps a run that is already planned: its day is taken and it counts", () => {
    const schedule = scheduleRunWeek(
      input({
        fixed_runs: [
          { workout_id: "w-1", date: d(0), run_type: "base", minutes: 40 },
        ],
      }),
    );
    expect(schedule.runs.map((r) => r.date)).not.toContain(d(0));
    expect(schedule.days[0].fixed).toHaveLength(1);
    expect(schedule.notes.map((n) => n.code)).toContain("fixed_run");
    expect(schedule.check.violations).toEqual([]);
  });

  it("steps a session up after two good runs and says why", () => {
    const history = [
      { ...run(2, 40, "base"), planned_minutes: 40, rpe: 3 },
      { ...run(4, 40, "base"), planned_minutes: 40, rpe: 3 },
    ];
    const schedule = scheduleRunWeek(
      input({ history, sessions: [session(1, "base", null)] }),
    );
    expect(schedule.runs[0].level).toBeGreaterThan(0);
    expect(schedule.notes.map((n) => n.code)).toContain("adaptation");
  });

  it("reserves time for a free run without a duration (unknown is not 0)", () => {
    const schedule = scheduleRunWeek(
      input({
        sessions: [session(1, "free", null), session(2, "base", [30, 45])],
      }),
    );
    const free = schedule.runs.find((r) => r.run_type === "free");
    expect(free?.minutes_reserved).toBe(true);
    expect(free?.minutes).toBeGreaterThan(0);
    expect(
      schedule.runs.find((r) => r.run_type === "base")?.minutes_reserved,
    ).toBe(false);
    expect(schedule.check.violations).toEqual([]);
  });

  it("re-enters carefully after a long pause: less volume, no hard run, with a hint", () => {
    const history = steadyHistory(2, 40, 4, d(-16));
    const schedule = scheduleRunWeek(input({ history }));
    expect(schedule.context.reentry).toBe("long");
    expect(hardRuns(schedule)).toEqual([]);
    expect(schedule.notes.map((n) => n.code)).toContain("reentry");
    expect(schedule.check.violations).toEqual([]);
    expect(
      schedule.runs.reduce((s, r) => s + r.minutes, 0),
    ).toBeLessThanOrEqual(
      Math.floor(schedule.context.volume.reference_minutes * 0.65),
    );
  });

  it("plans a deload week after three build weeks", () => {
    const schedule = scheduleRunWeek(input({ history: steadyHistory(3, 40) }));
    expect(schedule.context.deload).toBe(true);
    expect(schedule.notes.map((n) => n.code)).toContain("deload");
    expect(schedule.check.violations).toEqual([]);
  });

  it("shortens or converts the long run to stay within 15 minutes more than the longest run", () => {
    const history = steadyHistory(2, 30);
    const schedule = scheduleRunWeek(
      input({ history, sessions: typicalSessions() }),
    );
    const cap = schedule.context.long_cap_min;
    for (const r of schedule.runs.filter((x) => x.run_type === "long"))
      expect(r.minutes).toBeLessThanOrEqual(cap);
    expect(schedule.check.violations).toEqual([]);
  });

  it("refuses an invalid calendar day instead of guessing", () => {
    expect(() => scheduleRunWeek(input({ today: "2026-02-30" }))).toThrow();
  });
});
