import { describe, expect, it } from "vitest";
import {
  computeScores,
  consistencyScore,
  dailyHealthBaselines,
  progressScore,
  recoveryScore,
  roundScore,
  type DailyHealthInput,
  type ScoreHealthInput,
  type ScoreInput,
  type ScoreRunInput,
  type ScoreSetInput,
} from "../src/analytics/index.js";
import { addDays } from "../src/analytics/period.js";

/**
 * UX-009. Invented values only. Every date is fixed: nothing here depends on
 * the clock or the time zone of the machine running the tests.
 */
const REF = "2026-11-16"; // a Monday
const NOW = "2026-11-16T07:00:00Z";

const noConsent: ScoreHealthInput = { status: "no_consent" };
const consented = (
  daily: DailyHealthInput[] = [],
  before: Extract<ScoreHealthInput, { status: "consented" }>["before"] = [],
): ScoreHealthInput => ({ status: "consented", daily, before, now_utc: NOW });

const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  reference_date: REF,
  weekly_goal: 3,
  training_dates: [],
  sets: [],
  runs: [],
  health: noConsent,
  ...over,
});

const set = (
  date: string,
  exercise: string,
  load: number | null,
  reps: number | null,
  basis: ScoreSetInput["load_basis"] = "total",
): ScoreSetInput => ({
  date,
  exercise_id: exercise,
  comparison_key: `${exercise}|${basis}|bilateral_simultaneous|1`,
  load_basis: basis,
  load_kg: load,
  reps,
});

let runId = 0;
const run = (
  date: string,
  km: number | null,
  minutes: number | null,
  type: ScoreRunInput["run_type"] = "easy",
  hr: number | null = null,
): ScoreRunInput => ({
  workout_id: `run-${(runId += 1)}`,
  date,
  run_type: type,
  distance_m: km === null ? null : km * 1000,
  duration_s: minutes === null ? null : minutes * 60,
  hr_avg_bpm: hr,
});

const day = (
  local_date: string,
  values: Partial<DailyHealthInput> = {},
): DailyHealthInput => ({
  local_date,
  resting_hr_bpm: null,
  body_battery_high: null,
  body_battery_end_of_day: null,
  sleep_seconds: null,
  sleep_score: null,
  hrv_last_night_ms: null,
  ...values,
});

/** Training days in the completed week that starts `weeksBack` Mondays ago. */
const week = (weeksBack: number, days: number) =>
  Array.from({ length: days }, (_, i) => addDays(REF, -7 * weeksBack + i));

describe("roundScore", () => {
  it("rounds half up and stays within 0–100", () => {
    expect(roundScore(74.5)).toBe(75);
    expect(roundScore(74.49)).toBe(74);
    expect(roundScore(0.5)).toBe(1);
    expect(roundScore(79.1666)).toBe(79);
    expect(roundScore(-3)).toBe(0);
    expect(roundScore(100.4)).toBe(100);
  });
});

describe("Konstanz", () => {
  it("matches the worked example: 1, 1, 0.67, 1, 0.33, 1, 1, 0.33 → 79", () => {
    // Oldest to newest week: 3, 3, 2, 3, 1, 3, 3, 1 days against a goal of 3.
    const perWeek = [3, 3, 2, 3, 1, 3, 3, 1];
    const dates = perWeek.flatMap((d, i) => week(8 - i, d));
    const score = consistencyScore(input({ training_dates: dates }));
    expect(score).toMatchObject({
      status: "ok",
      value: 79,
      weeks_counted: 8,
      weeks_goal_met: 5,
      weekly_goal: 3,
    });
  });

  it("is too little data without any training", () => {
    expect(consistencyScore(input())).toMatchObject({
      status: "insufficient_data",
      value: null,
      reason: "no_data",
    });
  });

  it("is too little data without a weekly goal", () => {
    const dates = [...week(1, 3), ...week(2, 3), ...week(3, 3)];
    expect(
      consistencyScore(input({ weekly_goal: null, training_dates: dates })),
    ).toMatchObject({ status: "insufficient_data", reason: "no_weekly_goal" });
  });

  it("is too little data after one or two completed weeks", () => {
    expect(
      consistencyScore(input({ training_dates: week(1, 3) })),
    ).toMatchObject({
      status: "insufficient_data",
      reason: "too_few_weeks",
      weeks_counted: 1,
    });
    expect(
      consistencyScore(
        input({ training_dates: [...week(2, 1), ...week(1, 3)] }),
      ),
    ).toMatchObject({ reason: "too_few_weeks", weeks_counted: 2 });
  });

  it("starts with the week of the first training and ignores the running week", () => {
    const dates = [...week(3, 3), ...week(2, 0), ...week(1, 3), ...week(0, 5)];
    // Weeks 3, 2, 1 count: 1 + 0 + 1 = 2 of 3.
    expect(consistencyScore(input({ training_dates: dates }))).toMatchObject({
      status: "ok",
      value: 67,
      weeks_counted: 3,
      weeks_goal_met: 2,
    });
  });

  it("caps a week at its goal and looks back at most eight weeks", () => {
    const dates = Array.from({ length: 12 }, (_, i) => week(i + 1, 6)).flat();
    expect(consistencyScore(input({ training_dates: dates }))).toMatchObject({
      value: 100,
      weeks_counted: 8,
    });
  });
});

describe("Fortschritt", () => {
  const A = addDays(REF, -3);
  const B = addDays(REF, -25);

  it("compares strength by estimated max with reps capped at 12", () => {
    const score = progressScore(
      input({
        sets: [
          // up: 100 × (1 + 5/30) = 116.7 against 100 × (1 + 3/30) = 110
          set(A, "bench", 100, 5),
          set(B, "bench", 100, 3),
          // same: 20 reps count as 12 in both windows
          set(A, "row", 60, 20),
          set(B, "row", 60, 12),
          // down
          set(A, "squat", 90, 5),
          set(B, "squat", 100, 5),
        ],
      }),
    );
    expect(score).toMatchObject({
      status: "ok",
      value: 50,
      compared: 3,
      improved: 1,
      held: 1,
      exercises_compared: 3,
      exercises_improved: 1,
    });
  });

  it("counts most repetitions for bodyweight exercises and skips assistance", () => {
    const score = progressScore(
      input({
        sets: [
          set(A, "pullup", null, 9, "bodyweight_only"),
          set(B, "pullup", null, 8, "bodyweight_only"),
          set(A, "dip", 20, 8, "assistance"),
          set(B, "dip", 30, 8, "assistance"),
        ],
      }),
    );
    expect(score).toMatchObject({
      status: "insufficient_data",
      reason: "too_few_comparisons",
      compared: 1,
      improved: 1,
    });
  });

  it("leaves sets with unknown load out instead of counting them as 0", () => {
    const score = progressScore(
      input({
        sets: [
          set(A, "bench", null, 5),
          set(B, "bench", 100, 5),
          set(A, "row", 60, 8),
          set(B, "row", 60, 8),
        ],
      }),
    );
    expect(score).toMatchObject({
      status: "insufficient_data",
      compared: 1,
      held: 1,
    });
  });

  it("is too little data without anything to compare", () => {
    expect(progressScore(input())).toMatchObject({
      status: "insufficient_data",
      value: null,
      reason: "no_data",
    });
  });

  it("scores runs only: easy pace, fast pace and longest run", () => {
    const score = progressScore(
      input({
        runs: [
          run(A, 6, 33), // easy, faster than before
          run(B, 6, 36),
          run(A, 5, 22, "tempo"), // fast, same speed
          run(B, 5, 22, "tempo"),
          run(addDays(A, -1), 12, 70, "long"), // longest: 12 against 10 km
          run(addDays(B, -1), 10, 60, "long"),
          run(A, 2, 9), // under 3 km: ignored
          run(A, 8, null), // unknown duration: ignored
        ],
      }),
    );
    expect(score.runs).toEqual([
      { metric: "easy_pace", verdict: "up" },
      { metric: "fast_pace", verdict: "same" },
      { metric: "longest_run", verdict: "up" },
    ]);
    expect(score).toMatchObject({ status: "ok", value: 83, compared: 3 });
  });

  it("uses speed per heart beat for easy runs only with consent", () => {
    // Same pace, but the heart rate dropped: more efficient.
    const runs = [run(A, 6, 36, "easy", 140), run(B, 6, 36, "easy", 150)];
    expect(progressScore(input({ runs, health: consented() })).runs[0]).toEqual(
      { metric: "easy_efficiency", verdict: "up" },
    );
    // Revoked or never given: back to plain pace.
    expect(progressScore(input({ runs })).runs[0]).toEqual({
      metric: "easy_pace",
      verdict: "same",
    });
  });

  it("only counts strength: no run values without runs", () => {
    const score = progressScore(
      input({
        sets: [
          set(A, "a", 50, 5),
          set(B, "a", 50, 5),
          set(A, "b", 50, 5),
          set(B, "b", 50, 5),
          set(A, "c", 50, 5),
          set(B, "c", 50, 5),
        ],
      }),
    );
    expect(score).toMatchObject({ status: "ok", value: 50, runs: [] });
  });
});

describe("Erholung", () => {
  // Base window: 28 days before the last 7. Four base days with 10 sets each
  // give 40 points, i.e. 10 per week. 14 sets in the last 7 days → r = 1.4,
  // deduction 70 × 0.4 = 28 → T = 72.
  const baseDays = [
    addDays(REF, -34),
    addDays(REF, -27),
    addDays(REF, -20),
    addDays(REF, -13),
  ];
  const recentDay = addDays(REF, -4);
  const sets = [
    ...baseDays.flatMap((d) =>
      Array.from({ length: 10 }, () => set(d, "x", 50, 5)),
    ),
    ...Array.from({ length: 14 }, () => set(recentDay, "x", 50, 5)),
  ];
  const training_dates = [...baseDays, recentDay];
  const prior = Array.from({ length: 6 }, (_, i) =>
    day(addDays(REF, -(i + 1)), { resting_hr_bpm: 50, hrv_last_night_ms: 50 }),
  );
  const today = day(REF, {
    sleep_score: 81,
    resting_hr_bpm: 52, // 2 above the median 50 → 80
    hrv_last_night_ms: 47, // 6 % below 50 → 76
    body_battery_high: 74,
  });

  it("matches the worked example: T 72 and watch 81, 80, 76, 74 → 75", () => {
    const score = recoveryScore(
      input({ sets, training_dates, health: consented([...prior, today]) }),
    );
    expect(score).toMatchObject({
      status: "ok",
      value: 75,
      training_part: 72,
      watch_part: 78,
      watch: "used",
      watch_source: "daily",
      load_ratio: 1.4,
      consecutive_days: 0,
      strongest_deduction: { kind: "load_increase", points: 28 },
      best: { kind: "sleep", value: 81 },
    });
    expect(score.parts).toEqual([
      { kind: "sleep", value: 81 },
      { kind: "resting_hr", value: 80 },
      { kind: "hrv", value: 76 },
      { kind: "body_battery", value: 74 },
    ]);
  });

  it("uses only the training part without consent or after a revocation", () => {
    const score = recoveryScore(input({ sets, training_dates }));
    expect(score).toMatchObject({
      status: "ok",
      value: 72,
      watch: "no_consent",
      watch_part: null,
      parts: [],
      best: { kind: "training", value: 72 },
    });
  });

  it("uses only the training part when reading the watch values failed", () => {
    expect(
      recoveryScore(
        input({ sets, training_dates, health: { status: "unavailable" } }),
      ),
    ).toMatchObject({ value: 72, watch: "unavailable", watch_part: null });
  });

  it("averages only the watch values that exist", () => {
    const score = recoveryScore(
      input({
        sets,
        training_dates,
        health: consented([day(REF, { body_battery_high: 90 })]),
      }),
    );
    // Resting heart rate and HRV lack five earlier values; sleep is missing.
    expect(score).toMatchObject({ value: 81, watch_part: 90 });
    expect(score.parts).toEqual([{ kind: "body_battery", value: 90 }]);
  });

  it("falls back to sleep duration against its own earlier median", () => {
    const earlier = Array.from({ length: 5 }, (_, i) =>
      day(addDays(REF, -(i + 2)), { sleep_seconds: 28_800 }),
    );
    const score = recoveryScore(
      input({
        sets,
        training_dates,
        health: consented([
          ...earlier,
          day(addDays(REF, -1), { sleep_seconds: 21_600 }),
        ]),
      }),
    );
    expect(score.parts).toEqual([{ kind: "sleep", value: 75 }]);
  });

  it("ignores watch values older than yesterday", () => {
    const score = recoveryScore(
      input({
        sets,
        training_dates,
        health: consented([day(addDays(REF, -2), { body_battery_high: 90 })]),
      }),
    );
    expect(score).toMatchObject({ value: 72, watch: "no_values" });
  });

  it("falls back to fresh before-workout values within 72 hours", () => {
    const before = [
      ...Array.from({ length: 5 }, (_, i) => ({
        at_utc: `2026-11-0${i + 1}T07:00:00Z`,
        resting_hr: 50,
        body_battery: null,
      })),
      { at_utc: "2026-11-14T08:00:00Z", resting_hr: 53, body_battery: 60 },
    ];
    const score = recoveryScore(
      input({ sets, training_dates, health: consented([], before) }),
    );
    expect(score).toMatchObject({ watch_source: "before_workout" });
    expect(score.parts).toEqual([
      { kind: "resting_hr", value: 70 },
      { kind: "body_battery", value: 60 },
    ]);
    const stale = recoveryScore(
      input({
        sets,
        training_dates,
        health: consented(
          [],
          [
            {
              at_utc: "2026-11-12T06:00:00Z",
              resting_hr: 50,
              body_battery: 80,
            },
          ],
        ),
      }),
    );
    expect(stale).toMatchObject({ value: 72, watch: "no_values" });
  });

  it("deducts consecutive training days from the third on, at most 30", () => {
    const streak = Array.from({ length: 6 }, (_, i) => addDays(REF, -(i + 1)));
    const score = recoveryScore(
      input({
        sets: baseDays.flatMap((d) =>
          Array.from({ length: 10 }, () => set(d, "x", 50, 5)),
        ),
        training_dates: [...baseDays, ...streak],
      }),
    );
    // No load in the last 7 days (r = 0), six days in a row up to yesterday.
    expect(score).toMatchObject({
      value: 70,
      consecutive_days: 6,
      strongest_deduction: { kind: "consecutive_days", points: 30 },
    });
  });

  it("counts hard run minutes double", () => {
    const runs = [
      run(baseDays[0], 10, 200),
      run(baseDays[1], 10, 200),
      run(recentDay, 10, 50, "intervals"), // 10 min/5 × 2 = 20 points
    ];
    // Base: 400 min / 5 = 80 → 20 per week; recent 20 → r = 1, T = 100.
    const score = recoveryScore(
      input({ runs, training_dates: [...baseDays, recentDay] }),
    );
    expect(score).toMatchObject({ value: 100, load_ratio: 1 });
  });

  it("is too little data under 28 days since the first training", () => {
    expect(
      recoveryScore(
        input({ sets, training_dates: [addDays(REF, -27), recentDay] }),
      ),
    ).toMatchObject({
      status: "insufficient_data",
      reason: "too_short_history",
    });
  });

  it("is too little data with under two training weeks in the base window", () => {
    expect(
      recoveryScore(input({ sets, training_dates: [baseDays[0], recentDay] })),
    ).toMatchObject({
      status: "insufficient_data",
      reason: "too_few_training_weeks",
    });
  });

  it("is too little data when the base load is unknown, never a guess", () => {
    expect(
      recoveryScore(
        input({
          runs: [run(baseDays[0], 8, null), run(baseDays[1], 8, null)],
          training_dates: baseDays,
        }),
      ),
    ).toMatchObject({ status: "insufficient_data", reason: "no_base_load" });
  });

  it("is too little data without any training", () => {
    expect(recoveryScore(input())).toMatchObject({
      status: "insufficient_data",
      reason: "no_data",
    });
  });
});

describe("dailyHealthBaselines", () => {
  it("builds the basis from earlier days only, at least five values", () => {
    const days = [
      ...[60, 60, 60, 60, 60].map((v, i) =>
        day(addDays(REF, -(i + 1)), { resting_hr_bpm: v }),
      ),
      day(REF, { resting_hr_bpm: 70 }),
    ];
    const result = dailyHealthBaselines(days, REF);
    // With the current value included the median would still be 60, so
    // check the count: the day itself is not part of its own basis.
    expect(result.resting_hr).toEqual({
      value: 70,
      local_date: REF,
      baseline: { value: 60, count: 5 },
    });
    expect(dailyHealthBaselines(days.slice(1), REF).resting_hr?.baseline).toBe(
      null,
    );
  });
});

describe("scores as a whole", () => {
  it("is deterministic and independent of input order", () => {
    const sets = [
      set("2026-11-10", "a", 50, 5),
      set("2026-10-20", "a", 45, 5),
      set("2026-11-11", "b", 30, 8),
      set("2026-10-21", "b", 30, 8),
    ];
    const one = computeScores(
      input({ sets, training_dates: ["2026-10-20", "2026-11-10"] }),
    );
    const two = computeScores(
      input({
        sets: [...sets].reverse(),
        training_dates: ["2026-11-10", "2026-10-20"],
      }),
    );
    expect(two).toEqual(one);
    expect(computeScores(input({ sets }))).toEqual(
      computeScores(input({ sets })),
    );
  });
});
