/**
 * RUN-003: every existing reader of workouts ignores runs and planned
 * workouts. The strength figures of a dataset stay exactly the same when the
 * same dataset also holds completed runs, planned runs (also after the last
 * strength day), a run profile and run sessions in the active plan.
 *
 * RUN-022: the one exception is the count of training days. The calendar days
 * of completed runs count there (tests/analytics-run-days.test.ts), so the
 * comparisons below leave those figures out; everything else is identical.
 */
import type { DatasetWithHomeRuns } from "../src/server/run/home-days";
import { describe, expect, it } from "vitest";
import {
  buildArnoldDashboardAnalytics,
  buildHomeAnalytics,
} from "../src/analytics/index";
import type { DatasetWithRunDays } from "../src/analytics/activity";
import type { HomeAnalytics } from "../src/analytics/home";
import { goalPoints } from "../src/analytics/goals";
import {
  buildDashboardView,
  buildWorkoutHistoryView,
} from "../src/server/arnold-presenter";
import { storeSource } from "../src/server/arnold-source";
import { buildDirectory, buildRecent } from "../src/server/watch/plan";
import { proposeActivePlan } from "../src/server/workout/proposal";
import { workoutCount } from "../src/server/plan/domain";
import type { ArnoldStore } from "../src/server/workout/infrastructure";
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
      timezone: "Europe/Berlin",
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

/** fullDataset() plus running data of every kind. */
function withRunning(): ArnoldDataset {
  const base = fullDataset();
  const runs = [
    run("run-1", "2026-09-08", "completed"),
    // Same day as a strength workout, inside the plan.
    run("run-2", "2026-10-12", "completed", "sess-run-base"),
    run("run-3", "2026-10-15", "planned"),
    // After the last strength day: must not move the reference date.
    run("run-4", "2026-12-24", "planned", "sess-run-base"),
  ];
  return ArnoldDatasetSchema.parse({
    ...base,
    workouts: [...base.workouts, ...runs.map((r) => r.workout)],
    runs: runs.map((r) => r.run),
    runSegments: [
      {
        run_segment_id: "seg-1",
        workout_id: "run-1",
        segment_index: 0,
        repetition: null,
        kind: "lap",
        planned_duration_type: null,
        planned_duration_value: null,
        target_type: null,
        target_low: null,
        target_high: null,
        timer_s: 380,
        distance_m: 1000,
        time_in_target_s: null,
        status: "completed",
        hr_avg_bpm: null,
        hr_max_bpm: null,
        ...technical,
      },
    ],
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

/** Day figures that completed runs legitimately change (RUN-022). */
const DAY_FIGURES = new Set([
  "training_days",
  "completed_training_days",
  "average_training_days_per_week",
  "training_days_current_month",
  "first_training_date",
  "last_training_date",
  "trained_dates",
  "week_streak",
  "streak",
]);
function withoutDayFigures(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDayFigures);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !DAY_FIGURES.has(key))
        .map(([key, entry]) => [key, withoutDayFigures(entry)]),
    );
  return value;
}

const fakeStore = (dataset: ArnoldDataset) =>
  ({ read: async () => dataset }) as unknown as ArnoldStore;
const source = (dataset: ArnoldDataset) =>
  storeSource(fakeStore(dataset), {
    synthetic: true,
    label: "Test",
    description: "Test",
  });

describe("strength readers with running data in the dataset", () => {
  const base = fullDataset();
  const mixed = withRunning();

  it("the strength view of the mixed dataset is the strength dataset", () => {
    expect(mixed.workouts.length).toBe(base.workouts.length + 4);
    expect(strengthTrainingView(mixed)).toEqual(base);
    // Nothing to remove: the same object comes back.
    expect(strengthTrainingView(base)).toBe(base);
  });

  it("keeps the dashboard analytics and the start screen figures identical", () => {
    expect(withoutDayFigures(buildArnoldDashboardAnalytics(mixed))).toEqual(
      withoutDayFigures(buildArnoldDashboardAnalytics(base)),
    );
    // Running records are the one figure runs are meant to change.
    const strengthOnly = ({ run_records: _, ...rest }: HomeAnalytics) => rest;
    for (const weekly of [null, 3])
      expect(
        withoutDayFigures(
          strengthOnly(
            buildHomeAnalytics(mixed, { weekly_goal_training_days: weekly }),
          ),
        ),
      ).toEqual(
        withoutDayFigures(
          strengthOnly(
            buildHomeAnalytics(base, { weekly_goal_training_days: weekly }),
          ),
        ),
      );
    expect(
      buildHomeAnalytics(base).run_records.every((r) => r.value === null),
    ).toBe(true);
    expect(
      buildHomeAnalytics(mixed).run_records.some((r) => r.value !== null),
    ).toBe(true);
  });

  it("keeps goal progress, plan proposals and plan workout counts identical", () => {
    const target = {
      kind: "exercise_load",
      exercise_id: EXERCISES.bench,
      load_basis: "total",
    } as const;
    expect(goalPoints(mixed, target)).toEqual(goalPoints(base, target));
    expect(proposeActivePlan(mixed)).toEqual(proposeActivePlan(base));
    for (const id of ["pv-test-1", "pv-test-2"])
      expect(workoutCount(mixed, id)).toBe(workoutCount(base, id));
  });

  it("shows the same dashboard and workout history through the data source", async () => {
    const context = { generatedAt: "2026-11-13T06:00:00Z" };
    const loaded = (await source(mixed).load()).dataset as DatasetWithRunDays;
    // The loader hands over the strength dataset plus the days of completed
    // runs; those two completed runs are the only addition (RUN-022).
    // UX-009 adds the run summaries the scores need; nothing else reads them.
    const {
      runTrainingDates: runDays,
      runScoreInputs: runScores,
      // UX-014: the run recap's inputs travel the same way.
      runRecapInputs: runRecaps,
      // Running records and running goals read the completed runs whole.
      runRecordInputs: runRecords,
      // The start screen reads planned and completed runs by day.
      homeRuns,
      ...fromMixed
    } = loaded as DatasetWithRunDays & DatasetWithHomeRuns;
    expect(homeRuns?.runs.map((r) => [r.workout_id, r.status])).toEqual([
      ["run-1", "completed"],
      ["run-2", "completed"],
      ["run-3", "planned"],
      ["run-4", "planned"],
    ]);
    expect(runRecords?.map((r) => r.workout_id)).toEqual(["run-1", "run-2"]);
    expect(runDays).toEqual(["2026-09-08", "2026-10-12"]);
    expect(runScores?.map((r) => [r.workout_id, r.date])).toEqual([
      ["run-1", "2026-09-08"],
      ["run-2", "2026-10-12"],
    ]);
    expect(runRecaps?.map((r) => r.workout_id)).toEqual(["run-1", "run-2"]);
    expect(fromMixed).toEqual(base);
    expect(buildDashboardView(fromMixed, context)).toEqual(
      buildDashboardView(base, context),
    );
    expect(
      withoutDayFigures(buildDashboardView(loaded, context).totals),
    ).toEqual(withoutDayFigures(buildDashboardView(base, context).totals));
    expect(
      buildWorkoutHistoryView(fromMixed, context, {
        statuses: [
          "planned",
          "in_progress",
          "completed",
          "cancelled",
          "voided",
        ],
      }),
    ).toEqual(
      buildWorkoutHistoryView(base, context, {
        statuses: [
          "planned",
          "in_progress",
          "completed",
          "cancelled",
          "voided",
        ],
      }),
    );
  });

  it("gives the watch the same plan directory and recent exercises", () => {
    const view = strengthTrainingView(mixed);
    expect(buildDirectory(view, "de")).toEqual(buildDirectory(base, "de"));
    expect(buildRecent(view, "de")).toEqual(buildRecent(base, "de"));
  });
});
