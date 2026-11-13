import type { RunType } from "../src/shared/run-contract.js";
import { addDays } from "../src/analytics/period.js";
import {
  type AdaptationRun,
  type ScheduleRunWeekInput,
  type WeekHistoryRun,
  type WeekPlanRun,
  type WeekRunProfile,
  type WeekSessionInput,
} from "../src/analytics/running/index.js";

/** Monday, so calendar weeks and the window line up in the tests. */
export const TODAY = "2026-03-02";

export function profile(
  overrides: Partial<WeekRunProfile> = {},
): WeekRunProfile {
  return {
    goal: "fitness",
    race_date: null,
    running_experience_months: 36,
    runs_per_week: 4,
    long_run_weekday: 7,
    preferred_environment: "outdoor",
    base_minutes_per_week: 240,
    longest_run_4w_min: null,
    ...overrides,
  };
}

/** A completed run `daysAgo` days before `today`. */
export function run(
  daysAgo: number,
  minutes: number | null,
  run_type: RunType = "base",
  today = TODAY,
  extra: Partial<AdaptationRun> = {},
): AdaptationRun {
  return {
    workout_date_local: addDays(today, -daysAgo),
    run_type,
    status: "completed",
    timer_s: minutes === null ? null : minutes * 60,
    ...extra,
  };
}

/** Seven days of steady running ending yesterday: `perWeek` minutes in `weeks` blocks. */
export function steadyHistory(
  weeks: number,
  minutesPerRun: number,
  runsPerWeek = 4,
  today = TODAY,
): WeekHistoryRun[] {
  const days = [1, 3, 5, 7].slice(0, runsPerWeek);
  const out: WeekHistoryRun[] = [];
  for (let w = 0; w < weeks; w += 1)
    for (const d of days)
      out.push(run(w * 7 + d, minutesPerRun, "base", today));
  return out;
}

export function session(
  order: number,
  run_type: RunType,
  minutes: readonly [number, number] | null = [30, 60],
  extra: Partial<WeekSessionInput> = {},
): WeekSessionInput {
  return {
    session_id: `s-${order}`,
    session_order: order,
    session_name: `Lauf ${order}`,
    run_type,
    template:
      minutes === null
        ? { level: 0 }
        : { level: 0, minutes: [minutes[0], minutes[1]] },
    preferred_weekday: null,
    ...extra,
  };
}

/** A typical four-session week: two base runs, a long run and a tempo run. */
export function typicalSessions(): WeekSessionInput[] {
  return [
    session(1, "base", [30, 45]),
    session(2, "tempo", [30, 50]),
    session(3, "base", [30, 45]),
    session(4, "long", [45, 90]),
  ];
}

export function scheduleInput(
  overrides: Partial<ScheduleRunWeekInput> = {},
): ScheduleRunWeekInput {
  return {
    today: TODAY,
    profile: profile(),
    history: steadyHistory(4, 40),
    sessions: typicalSessions(),
    ...overrides,
  };
}

/** A planned run for the checker. */
export function planned(
  date: string,
  run_type: RunType,
  minutes: number | null,
  intense: number | null | undefined = undefined,
): WeekPlanRun {
  return {
    date,
    run_type,
    minutes,
    intense_minutes:
      intense !== undefined
        ? intense
        : run_type === "tempo" ||
            run_type === "intervals" ||
            run_type === "threshold_intervals" ||
            run_type === "hills" ||
            run_type === "repetitions"
          ? minutes === null
            ? null
            : minutes * 0.5
          : 0,
  };
}

/** Mulberry32: small deterministic PRNG for the property test (no dependency). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
