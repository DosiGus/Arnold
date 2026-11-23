/**
 * MOB-002, D-MOB-08 ("not strength is not a run"): mobility is no training
 * day, no load and no run. A dataset with strength and running gives exactly
 * the same answers when it also holds a mobility profile, mobility routines
 * of the active plan and done mobility routines with their results: run
 * analysis, recap, scores, goals, progression, interference, the week
 * context of the run planner, the dashboard and the watch.
 *
 * Unlike runs (RUN-022) there is no exception for the day figures: a day with
 * only a mobility routine is not a training day.
 */
import { describe, expect, it } from "vitest";
import {
  buildArnoldDashboardAnalytics,
  buildHomeAnalytics,
} from "../src/analytics/index";
import { buildScores } from "../src/analytics/dashboard";
import { runTrainingDates } from "../src/analytics/activity";
import { goalPoints } from "../src/analytics/goals";
import {
  computeRecap,
  computeRunRecap,
  newestRun,
  newestWorkout,
  recapKind,
  runRecapInputsOf,
} from "../src/analytics/recap";
import { scoreRunsOf } from "../src/analytics/scores";
import {
  runInterference,
  strengthDays,
} from "../src/analytics/running/interference";
import {
  buildDashboardView,
  buildWorkoutHistoryView,
} from "../src/server/arnold-presenter";
import { storeSource } from "../src/server/arnold-source";
import { workoutCount } from "../src/server/plan/domain";
import {
  RunNotFoundError,
  analyseRuns,
  runInputs,
} from "../src/server/run/analysis";
import {
  activeRunPlan,
  buildWeekSetup,
  historyOf,
  projectStrength,
  strengthAround,
  strengthOfDays,
} from "../src/server/run/week";
import { buildDirectory, buildRecent } from "../src/server/watch/plan";
import type { ArnoldStore } from "../src/server/workout/infrastructure";
import { proposeActivePlan } from "../src/server/workout/proposal";
import {
  ArnoldDatasetSchema,
  strengthTrainingView,
  type ArnoldDataset,
} from "../src/shared/arnold-schema-v1";
import { EXERCISES, fullDataset } from "./fixtures/arnold-dashboard";

const STAMP = "2026-09-01T06:00:00Z";
const technical = {
  created_at_utc: STAMP,
  updated_at_utc: STAMP,
  row_revision: 1,
};
const TZ = "Europe/Berlin";

/* ------------------------------------------------------------ running */

function run(
  id: string,
  date: string,
  status: "planned" | "completed",
  session?: string,
) {
  const done = status === "completed";
  return {
    workout: {
      workout_id: id,
      workout_date_local: date,
      timezone: TZ,
      started_at_utc: done ? `${date}T17:00:00Z` : null,
      ended_at_utc: done ? `${date}T17:45:00Z` : null,
      plan_version_id: session ? "pv-test-2" : null,
      session_id: session ?? null,
      session_name_snapshot: "Grundlage",
      status,
      source: "chat",
      notes: null,
      ...technical,
      activity_type: "run",
    },
    run: {
      workout_id: id,
      run_type: "base",
      environment: "outdoor",
      prescription: { k: 1, n: "Grundlage", e: 0, s: [[1, 1, 2700, 1, 1, 2]] },
      rationale: null,
      rules_version: null,
      timer_s: done ? 2700 : null,
      elapsed_s: done ? 2700 : null,
      distance_m: done ? 7000 : null,
      distance_source: done ? "manual" : null,
      ascent_m: null,
      descent_m: null,
      cadence_spm: null,
      calories_kcal: null,
      te_aerobic: null,
      te_anaerobic: null,
      rpe: done ? 3 : null,
      splits_100m: null,
      pause_count: null,
      result_source: done ? "chat" : null,
      hr_status: done ? "not_provided" : null,
      hr_avg_bpm: null,
      hr_max_bpm: null,
      hr_zone_seconds: null,
      ...technical,
    },
  };
}

/** fullDataset() (strength) plus running of every kind. */
function strengthAndRunning(): ArnoldDataset {
  const base = fullDataset();
  const runs = [
    run("run-1", "2026-09-08", "completed"),
    // Same day as a strength workout, inside the plan.
    run("run-2", "2026-10-12", "completed", "sess-run-base"),
    run("run-3", "2026-10-15", "planned"),
    run("run-4", "2026-12-24", "planned", "sess-run-base"),
  ];
  return ArnoldDatasetSchema.parse({
    ...base,
    workouts: [...base.workouts, ...runs.map((r) => r.workout)],
    runs: runs.map((r) => r.run),
    planRunSessions: [
      {
        plan_run_session_id: "prs-1",
        plan_version_id: "pv-test-2",
        session_id: "sess-run-base",
        session_order: 9,
        session_name: "Grundlage",
        run_type: "base",
        template: { level: 0, minutes: [30, 60] },
        preferred_weekday: 3,
        status: "active",
        row_revision: 1,
      },
    ],
    runProfiles: [
      {
        run_profile_id: "rp-1",
        goal: "10k",
        race_date: "2027-02-15",
        target_time_s: 3000,
        reference_distance_m: null,
        reference_time_s: null,
        reference_date: null,
        reference_source: null,
        running_experience_months: 6,
        runs_per_week: 3,
        long_run_weekday: 7,
        preferred_environment: "outdoor",
        base_minutes_per_week: 90,
        longest_run_4w_min: 60,
        alarm_settings: null,
        ...technical,
      },
    ],
  });
}

/* ----------------------------------------------------------- mobility */

const template = {
  catalog_version: "mob-1",
  rules_version: "mob-timing-1",
  exercise_ids: ["mob_neck_rolls", "mob_shoulder_circles"],
  items: [
    {
      exercise_id: "mob_neck_rolls",
      sides: 1,
      seconds_per_side: 45,
      reps: null,
    },
    {
      exercise_id: "mob_shoulder_circles",
      sides: 1,
      seconds_per_side: 45,
      reps: null,
    },
  ],
  total_s: 95,
};

function routine(
  id: string,
  date: string,
  kind: "morning" | "session",
  session: string | null,
  status: "completed" | "cancelled" = "completed",
) {
  return {
    workout: {
      workout_id: id,
      workout_date_local: date,
      timezone: TZ,
      started_at_utc: `${date}T06:30:00Z`,
      ended_at_utc: `${date}T06:42:00Z`,
      plan_version_id: session ? "pv-test-2" : null,
      session_id: session,
      session_name_snapshot: kind === "morning" ? "Morgenroutine" : "Mobility",
      status,
      source: "sync",
      notes: null,
      ...technical,
      activity_type: "mobility",
    },
    result: {
      workout_id: id,
      activity_type: "mobility",
      kind,
      plan_version_id: session ? "pv-test-2" : null,
      session_id: session,
      minutes_planned: kind === "morning" ? 10 : 20,
      timer_s: 600,
      elapsed_s: 720,
      exercises_total: 2,
      exercises_done: 1,
      exercises_skipped: 1,
      ended_early: false,
      items: [
        { c: "mob_neck_rolls", st: "done", t: 45 },
        { c: "mob_shoulder_circles", st: "skipped", t: 0 },
      ],
      result_source: "watch",
      catalog_version: "mob-1",
      rules_version: "mob-timing-1",
      ...technical,
    },
  };
}

/** The same dataset plus mobility of every kind. */
function withMobility(base: ArnoldDataset): ArnoldDataset {
  const routines = [
    // On a run day.
    routine("mob-1", "2026-09-08", "morning", "sess-mob-morning"),
    // On a strength and run day, after strength.
    routine("mob-2", "2026-10-12", "session", "sess-mob-after"),
    // A day with nothing else, between strength days.
    routine("mob-3", "2026-10-13", "morning", "sess-mob-morning"),
    // After the last strength day: must not move any reference date.
    routine("mob-4", "2026-11-14", "session", null),
    routine("mob-5", "2026-12-26", "morning", null, "cancelled"),
  ];
  return ArnoldDatasetSchema.parse({
    ...base,
    workouts: [...base.workouts, ...routines.map((r) => r.workout)],
    mobilityResults: routines.map((r) => r.result),
    mobilityProfiles: [
      {
        mobility_profile_id: "mp-1",
        wants: true,
        morning_weekdays: [1, 2, 3, 4, 5],
        morning_minutes: 10,
        sessions_placement: "after_strength",
        sessions_per_week: 2,
        sessions_minutes: 20,
        stiff_areas: ["hips", "upper_back"],
        ...technical,
      },
    ],
    planMobilitySessions: [
      {
        plan_mobility_session_id: "pms-1",
        plan_version_id: "pv-test-2",
        session_id: "sess-mob-morning",
        session_name: "Morgenroutine",
        session_order: 20,
        kind: "morning",
        placement: "own_day",
        weekdays: [1, 2, 3, 4, 5],
        after_session_id: null,
        minutes: 10,
        template,
        status: "active",
        row_revision: 1,
      },
      {
        plan_mobility_session_id: "pms-2",
        plan_version_id: "pv-test-2",
        session_id: "sess-mob-after",
        session_name: "Mobility nach Unterkörper",
        session_order: 21,
        kind: "session",
        placement: "after_strength",
        weekdays: [],
        after_session_id: "sess-lower-b",
        minutes: 20,
        template,
        status: "active",
        row_revision: 1,
      },
    ],
  });
}

/** A result or the message of the error it threw: both must match. */
function outcome<T>(work: () => T): { ok: T } | { error: string } {
  try {
    return { ok: work() };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const fakeStore = (dataset: ArnoldDataset) =>
  ({ read: async () => dataset }) as unknown as ArnoldStore;
const source = (dataset: ArnoldDataset) =>
  storeSource(fakeStore(dataset), {
    synthetic: true,
    label: "Test",
    description: "Test",
  });

const REFERENCE_DATES = [
  "2026-09-08",
  "2026-10-12",
  "2026-10-13",
  "2026-10-21",
  "2026-11-14",
  "2026-12-26",
];
const NOW = new Date("2026-11-14T12:00:00Z");

describe("readers with mobility in the dataset (D-MOB-08)", () => {
  const base = strengthAndRunning();
  const mixed = withMobility(base);

  it("the mixed dataset really holds mobility of every kind", () => {
    expect(mixed.workouts.length).toBe(base.workouts.length + 5);
    expect(mixed.mobilityResults).toHaveLength(5);
    expect(mixed.planMobilitySessions).toHaveLength(2);
    // The strength view leaves mobility and running out alike.
    expect(strengthTrainingView(mixed)).toEqual(strengthTrainingView(base));
  });

  it("keeps the run analysis identical and finds no run in a mobility workout", () => {
    expect(runInputs(mixed)).toEqual(runInputs(base));
    for (const date of REFERENCE_DATES)
      for (const view of ["week", "four_weeks"] as const)
        expect(
          analyseRuns(mixed, { view, date, timezone: TZ }, NOW),
          `${view} ${date}`,
        ).toEqual(analyseRuns(base, { view, date, timezone: TZ }, NOW));
    for (const id of ["run-1", "run-2"])
      expect(
        analyseRuns(mixed, { view: "run", workout_id: id, timezone: TZ }, NOW),
      ).toEqual(
        analyseRuns(base, { view: "run", workout_id: id, timezone: TZ }, NOW),
      );
    expect(() =>
      analyseRuns(
        mixed,
        { view: "run", workout_id: "mob-2", timezone: TZ },
        NOW,
      ),
    ).toThrow(RunNotFoundError);
  });

  it("keeps the recap identical: a routine is neither the newest workout nor the newest run", () => {
    expect(runRecapInputsOf(mixed)).toEqual(runRecapInputsOf(base));
    for (const date of REFERENCE_DATES) {
      expect(recapKind(mixed, date), date).toEqual(recapKind(base, date));
      expect(newestWorkout(mixed, date), date).toEqual(
        newestWorkout(base, date),
      );
      expect(newestRun(mixed, date), date).toEqual(newestRun(base, date));
      expect(computeRunRecap(mixed, date), date).toEqual(
        computeRunRecap(base, date),
      );
      const recap = (data: ArnoldDataset) =>
        computeRecap(
          data,
          buildHomeAnalytics(data, {
            reference_date: date,
            weekly_goal_training_days: 3,
          }),
          proposeActivePlan(data),
          date,
        );
      expect(recap(mixed), date).toEqual(recap(base));
    }
  });

  it("keeps the scores identical, including the training days", () => {
    expect(scoreRunsOf(mixed)).toEqual(scoreRunsOf(base));
    expect(runTrainingDates(mixed)).toEqual(runTrainingDates(base));
    for (const date of [...REFERENCE_DATES, null])
      for (const weekly of [null, 3]) {
        const options = {
          reference_date: date,
          weekly_goal_training_days: weekly,
          health: { status: "no_consent" } as const,
        };
        expect(buildScores(mixed, options), `${date} ${weekly}`).toEqual(
          buildScores(base, options),
        );
      }
  });

  it("keeps goals, progression and plan workout counts identical", () => {
    for (const target of [
      {
        kind: "exercise_load",
        exercise_id: EXERCISES.bench,
        load_basis: "total",
      },
    ] as const)
      expect(goalPoints(mixed, target)).toEqual(goalPoints(base, target));
    expect(proposeActivePlan(mixed)).toEqual(proposeActivePlan(base));
    for (const id of ["pv-test-1", "pv-test-2"])
      expect(workoutCount(mixed, id)).toBe(workoutCount(base, id));
  });

  it("keeps interference and the week context of the run planner identical", () => {
    const days = strengthDays(mixed);
    expect(days).toEqual(strengthDays(base));
    for (const r of base.runs) {
      const workout = base.workouts.find((w) => w.workout_id === r.workout_id)!;
      const input = {
        date: workout.workout_date_local,
        run_type: r.run_type,
        session_id: workout.session_id,
      };
      for (const focus of ["running", "strength"] as const)
        expect(runInterference(input, days, focus)).toEqual(
          runInterference(input, strengthDays(base), focus),
        );
    }
    expect(activeRunPlan(mixed)).toEqual(activeRunPlan(base));
    expect(historyOf(mixed)).toEqual(historyOf(base));
    let setups = 0;
    for (const today of REFERENCE_DATES) {
      const dates = [today, "2026-10-14", "2026-10-15", "2026-11-15"];
      expect(strengthOfDays(mixed, "2026-09-01", today), today).toEqual(
        strengthOfDays(base, "2026-09-01", today),
      );
      expect(strengthAround(mixed, today, dates), today).toEqual(
        strengthAround(base, today, dates),
      );
      expect(
        outcome(() => projectStrength(mixed, today, dates)),
        today,
      ).toEqual(outcome(() => projectStrength(base, today, dates)));
      const setup = outcome(() => buildWeekSetup(mixed, today));
      expect(setup, today).toEqual(outcome(() => buildWeekSetup(base, today)));
      if ("ok" in setup) setups += 1;
    }
    // The comparison covers real week setups, not only equal refusals.
    expect(setups).toBeGreaterThan(0);
  });

  it("keeps the dashboard and the start screen identical, day figures included", async () => {
    expect(buildArnoldDashboardAnalytics(mixed)).toEqual(
      buildArnoldDashboardAnalytics(base),
    );
    for (const weekly of [null, 3])
      for (const date of [...REFERENCE_DATES, null])
        expect(
          buildHomeAnalytics(mixed, {
            reference_date: date,
            weekly_goal_training_days: weekly,
          }),
        ).toEqual(
          buildHomeAnalytics(base, {
            reference_date: date,
            weekly_goal_training_days: weekly,
          }),
        );
    const fromMixed = (await source(mixed).load()).dataset;
    const fromBase = (await source(base).load()).dataset;
    // MOB-005: the mobility facts travel next to the strength view as their
    // own field; everything else is the strength dataset of before.
    const { mobilityDay, ...strengthOnly } = fromMixed as typeof fromMixed & {
      mobilityDay?: unknown;
    };
    expect(mobilityDay).toBeDefined();
    expect((fromBase as { mobilityDay?: unknown }).mobilityDay).toBeUndefined();
    expect(strengthOnly).toEqual(fromBase);
    const context = { generatedAt: "2026-11-14T06:00:00Z" };
    // The start screen gets its own mobility line (only with a yes); nothing
    // else of the view changes.
    const mixedView = buildDashboardView(fromMixed, context);
    const { mobility: line, ...homeRest } = mixedView.home;
    expect(line === undefined || typeof line.line === "string").toBe(true);
    expect({ ...mixedView, home: homeRest }).toEqual(
      buildDashboardView(fromBase, context),
    );
    const statuses = [
      "planned",
      "in_progress",
      "completed",
      "cancelled",
      "voided",
    ] as const;
    expect(
      buildWorkoutHistoryView(fromMixed, context, { statuses: [...statuses] }),
    ).toEqual(
      buildWorkoutHistoryView(fromBase, context, { statuses: [...statuses] }),
    );
  });

  it("gives the watch the same plan directory and recent exercises", () => {
    const view = strengthTrainingView(mixed);
    const plain = strengthTrainingView(base);
    expect(buildDirectory(view, "de")).toEqual(buildDirectory(plain, "de"));
    expect(buildRecent(view, "de")).toEqual(buildRecent(plain, "de"));
  });
});
