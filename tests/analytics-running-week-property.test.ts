import { describe, expect, it } from "vitest";
import { addDays } from "../src/analytics/period.js";
import {
  HARD_RUN_TYPES,
  RUN_TYPES,
  type RunType,
} from "../src/shared/run-contract.js";
import {
  checkRunWeek,
  scheduleRunWeek,
  weekPlanRun,
  type AdaptationRun,
  type RunGoal,
  type ScheduleRunWeekInput,
  type StrengthDay,
  type WeekRunProfile,
  type WeekSessionInput,
} from "../src/analytics/running/index.js";
import { mulberry32 } from "./analytics-running-week-helpers.js";

/**
 * Property test for the acceptance criterion of the running feature: no week
 * plan made by `scheduleRunWeek` violates a week rule (`checkRunWeek`). The
 * profiles, histories, sessions and strength days are random but seeded, so a
 * failure reproduces (the case number and seed are in the message).
 */

const CASES = 1200;
const HARD = HARD_RUN_TYPES;
const SEED = 20261113;

type Rng = () => number;
const int = (rng: Rng, lo: number, hi: number) =>
  lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T>(rng: Rng, items: readonly T[]): T =>
  items[int(rng, 0, items.length - 1)];
const chance = (rng: Rng, p: number) => rng() < p;

const GOALS: readonly RunGoal[] = ["fitness", "5k", "10k", "half_marathon"];
const STATUSES = [
  "completed",
  "completed",
  "completed",
  "completed",
  "cancelled",
  "planned",
  "voided",
] as const;
/** Run types a session can have (a free run is allowed, a test only as a race). */
const SESSION_TYPES: readonly RunType[] = RUN_TYPES.filter(
  (type) => type !== "test",
);

function randomCase(index: number): ScheduleRunWeekInput {
  const rng = mulberry32(SEED + index * 7919);
  // a random Monday-based start date in 2026, any weekday
  const today = addDays("2026-01-05", int(rng, 0, 300));

  const goal = pick(rng, GOALS);
  const race =
    goal === "fitness"
      ? null
      : chance(rng, 0.85)
        ? addDays(today, int(rng, -3, 110))
        : null;
  const profile: WeekRunProfile = {
    goal,
    race_date: race,
    running_experience_months: chance(rng, 0.1) ? null : int(rng, 0, 60),
    runs_per_week: int(rng, 1, 6),
    long_run_weekday: chance(rng, 0.3) ? null : int(rng, 1, 7),
    preferred_environment: pick(rng, [
      "outdoor",
      "treadmill",
      "track",
    ] as const),
    base_minutes_per_week: chance(rng, 0.15) ? null : int(rng, 20, 420),
    longest_run_4w_min: chance(rng, 0.4) ? null : int(rng, 0, 120),
  };

  // history: none, short pause, long pause, a few weeks of runs, with gaps
  const history: AdaptationRun[] = [];
  const kind = int(rng, 0, 4);
  if (kind > 0) {
    const weeks = int(rng, 1, 6);
    const last = kind === 1 ? int(rng, 1, 3) : kind === 2 ? int(rng, 4, 40) : 1;
    const scale = int(rng, 15, 70);
    for (let ago = last; ago < last + weeks * 7; ago += 1) {
      if (!chance(rng, 0.5)) continue;
      const type = chance(rng, 0.7)
        ? pick(rng, ["base", "base", "recovery", "long", "run_walk"] as const)
        : pick(rng, RUN_TYPES);
      const minutes = chance(rng, 0.08) ? null : int(rng, 10, scale + 40);
      const hr = chance(rng, 0.3);
      const above = int(rng, 0, 60);
      history.push({
        workout_date_local: addDays(today, -ago),
        run_type: type,
        status: pick(rng, STATUSES),
        timer_s: minutes === null ? null : minutes * 60,
        planned_minutes: chance(rng, 0.7) ? int(rng, 20, 90) : null,
        rpe: chance(rng, 0.6) ? int(rng, 1, 10) : null,
        ...(hr
          ? {
              hr_status: "recorded" as const,
              hr_zone_seconds: [
                0,
                100 - above,
                above / 2,
                above / 4,
                above / 4,
              ],
            }
          : {}),
      });
    }
  }

  const sessionCount = int(rng, 0, 7);
  const sessions: WeekSessionInput[] = Array.from(
    { length: sessionCount },
    (_, i) => {
      const run_type = pick(rng, SESSION_TYPES);
      const lo = int(rng, 10, 60);
      return {
        session_id: `s-${i}`,
        session_order: i + 1,
        session_name: `Lauf ${i + 1}`,
        run_type,
        template: chance(rng, 0.8)
          ? { level: int(rng, 0, 4), minutes: [lo, lo + int(rng, 0, 90)] }
          : { level: int(rng, 0, 4) },
        preferred_weekday: chance(rng, 0.5) ? int(rng, 1, 7) : null,
        level: chance(rng, 0.3) ? int(rng, 0, 5) : null,
      };
    },
  );

  const strength_days: StrengthDay[] = [];
  if (chance(rng, 0.5))
    for (let offset = -7; offset < 7; offset += 1)
      if (chance(rng, 0.3)) {
        const unknown = chance(rng, 0.15);
        const legs = int(rng, 0, 12);
        strength_days.push({
          date: addDays(today, offset),
          leg_sets: unknown ? null : legs,
          heavy_legs: unknown ? null : legs >= 6,
          planned: offset >= 0,
        });
      }

  return {
    today,
    profile,
    history,
    sessions,
    strength_days,
    focus: chance(rng, 0.2)
      ? pick(rng, ["running", "strength"] as const)
      : null,
    block_start: chance(rng, 0.2) ? addDays(today, -int(rng, 0, 60)) : null,
  };
}

describe("property: scheduleRunWeek never breaks a week rule", () => {
  it(`holds for ${CASES} random profiles and histories (seed ${SEED})`, () => {
    let planned = 0;
    let withRuns = 0;
    const seen = new Set<string>();
    const failures: string[] = [];
    for (let index = 0; index < CASES; index += 1) {
      const input = randomCase(index);
      let schedule;
      try {
        schedule = scheduleRunWeek(input);
      } catch (error) {
        failures.push(`#${index}: threw ${(error as Error).message}`);
        continue;
      }
      planned += 1;
      if (schedule.runs.length > 0) withRuns += 1;
      seen.add(`phase:${schedule.context.phase}`);
      seen.add(`reentry:${schedule.context.reentry}`);
      if (schedule.context.deload) seen.add("deload");
      if (schedule.context.max_hard === 0) seen.add("no_hard_allowed");
      if (schedule.runs.some((run) => HARD.includes(run.run_type)))
        seen.add("hard_run_planned");
      if (schedule.runs.some((run) => run.minutes_reserved))
        seen.add("free_run_reserved");
      if (schedule.dropped.length > 0) seen.add("session_dropped");
      if (schedule.notes.some((note) => note.code === "session_converted"))
        seen.add("session_converted");
      if (schedule.notes.some((note) => note.code === "hard_on_leg_day"))
        seen.add("hard_on_leg_day");

      // the rule check the planner reports, and an independent one from the runs
      const again = checkRunWeek({
        today: input.today,
        profile: input.profile,
        history: input.history,
        focus: input.focus,
        has_strength: (input.strength_days ?? []).length > 0,
        block_start: input.block_start,
        strength_days: input.strength_days,
        runs: schedule.runs.map((run) =>
          weekPlanRun(run.date, {
            run_type: run.run_type,
            total_s: run.minutes * 60,
            work_s:
              run.intense_minutes === null ? null : run.intense_minutes * 60,
          }),
        ),
      });
      const rules = [...schedule.check.violations, ...again.violations].map(
        (violation) => `${violation.rule}: ${violation.text}`,
      );
      if (rules.length > 0) failures.push(`#${index}: ${rules.join(" | ")}`);

      // structure: distinct days inside the window, within the weekly run count
      const dates = schedule.runs.map((run) => run.date);
      if (new Set(dates).size !== dates.length)
        failures.push(`#${index}: two runs on one day`);
      if (dates.some((date) => !schedule.context.window.includes(date)))
        failures.push(`#${index}: run outside the window`);
      if (schedule.runs.length > Math.max(0, input.profile.runs_per_week))
        failures.push(`#${index}: more runs than runs_per_week`);
      if (
        schedule.runs.some(
          (run) => !(run.minutes > 0) || !Number.isFinite(run.minutes),
        )
      )
        failures.push(`#${index}: a run without positive minutes`);
      if (
        schedule.runs.length + schedule.dropped.length !==
        input.sessions.length
      )
        failures.push(`#${index}: sessions are neither planned nor dropped`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(planned).toBe(CASES);
    // the property must not hold only because nothing was planned
    expect(withRuns).toBeGreaterThan(CASES * 0.5);
    // and the random cases must reach the interesting situations
    for (const situation of [
      "phase:none",
      "phase:base",
      "phase:build",
      "phase:peak",
      "phase:taper",
      "phase:race_over",
      "reentry:none",
      "reentry:short",
      "reentry:long",
      "reentry:restart",
      "reentry:new",
      "deload",
      "no_hard_allowed",
      "hard_run_planned",
      "free_run_reserved",
      "session_dropped",
      "session_converted",
      "hard_on_leg_day",
    ])
      expect(seen, situation).toContain(situation);
  }, 120_000);

  it("is deterministic: the same input gives the same plan", () => {
    for (let index = 0; index < 40; index += 1) {
      const input = randomCase(index * 13);
      expect(scheduleRunWeek(input)).toEqual(scheduleRunWeek(input));
    }
  });

  it("does not change its input", () => {
    for (let index = 0; index < 40; index += 1) {
      const input = randomCase(index * 17);
      const copy = structuredClone(input);
      scheduleRunWeek(input);
      expect(input).toEqual(copy);
    }
  });
});
