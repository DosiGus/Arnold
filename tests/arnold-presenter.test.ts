import { describe, expect, it } from "vitest";
import {
  buildDashboardView,
  buildExerciseProgressView,
  buildWorkoutHistoryView,
  HEART_RATE_CURVE_POINTS,
  REASON_TEXT,
  reasonNote,
  watchSessionsOf,
  withWatchRecordings,
} from "../src/server/arnold-presenter";
import type { WatchRecordingData } from "../src/server/arnold-source";
import { AnalyticsReasonSchema, METRICS_VERSION } from "../src/analytics/types";
import { ARNOLD_UI_CONTRACT } from "../src/shared/arnold-view";
import {
  dataset,
  exercise,
  oneWorkout,
  plan,
  planItem,
  set,
  workout,
} from "./fixtures/arnold-analytics";

const CONTEXT = { generatedAt: "2026-10-25T09:00:00Z" };
const view = (data: Parameters<typeof buildDashboardView>[0], options = {}) =>
  buildDashboardView(data, CONTEXT, options);

describe("ArnoldDataset to dashboard DTO", () => {
  it("carries the versioned contract, source identity and engine versions", () => {
    const result = view(oneWorkout([{ load_kg: 70, reps: 10 }]));
    expect(result.ui_contract).toBe(ARNOLD_UI_CONTRACT);
    expect(result.source.mode).toBe("arnold");
    expect(result.source.read_only).toBe(true);
    expect(result.source.synthetic).toBe(false);
    expect(result.source.generated_at).toBe(CONTEXT.generatedAt);
    expect(result.source.schema_id).toBe("arnold.training_raw");
    expect(result.source.metrics_version).toBe(METRICS_VERSION);
  });

  it("takes every KPI from the analytics engine rather than recomputing it", () => {
    const data = oneWorkout([
      { load_kg: 70, reps: 10 },
      { load_kg: 70, reps: 8 },
    ]);
    const result = view(data);
    const kpi = (key: string) => result.kpis.find((k) => k.key === key)!;
    expect(kpi("workouts").value).toBe(1);
    expect(kpi("training_days").value).toBe(1);
    expect(kpi("working_sets").value).toBe(2);
    // 70*10 + 70*8
    expect(kpi("nominal_volume").value).toBe(1260);
    expect(kpi("nominal_volume").status).toBe("valid");
  });

  it("reports an unknown metric as null with an explanation, never as zero", () => {
    // A machine load has no free-weight-comparable volume.
    const data = oneWorkout([
      { load_kg: 50, reps: 10, load_basis: "machine_display" },
    ]);
    const result = view(data);
    const comparable = result.kpis.find((k) => k.key === "comparable_volume")!;
    expect(comparable.value).toBeNull();
    expect(comparable.status).not.toBe("valid");
    expect(comparable.note).toBeTruthy();
    expect(comparable.note).not.toMatch(/machine_display|per_implement/);
  });

  it("translates every engine reason into German, with no identifier leaking", () => {
    for (const reason of AnalyticsReasonSchema.options) {
      const text = REASON_TEXT[reason];
      expect(text, reason).toBeTruthy();
      expect(text, reason).not.toContain("_");
    }
    expect(reasonNote({ status: "valid", reasons: [] })).toBeNull();
    expect(
      reasonNote({ status: "not_available", reasons: ["load_missing"] }),
    ).toBe(REASON_TEXT.load_missing);
  });
});

describe("empty and template states", () => {
  it("reports an empty tracker without inventing example workouts", () => {
    const result = view(dataset({ exercises: [exercise()] }));
    expect(result.state).toBe("empty_history");
    expect(result.recent_workouts).toEqual([]);
    expect(result.records).toEqual([]);
    expect(result.weeks).toEqual([]);
    expect(result.totals.workouts_in_history).toBe(0);
    // The engine treats "no training at all" as a genuine zero; emptiness is
    // communicated through `state`, which is what the UI switches on.
    expect(result.kpis.find((k) => k.key === "workouts")!.value).toBe(0);
  });

  it("never presents the master template as a configured personal account", () => {
    const result = view(
      dataset({
        exercises: [exercise()],
        config: {
          file_role: "MASTER_TEMPLATE",
          tracker_id: "TEMPLATE_UNASSIGNED",
        },
      }),
    );
    expect(result.state).toBe("master_template");
    expect(result.source.file_role).toBe("MASTER_TEMPLATE");
    expect(result.notices.map((n) => n.code)).toContain("master_template");
  });
});

describe("workout history DTO", () => {
  it("uses the stored session name and does not require a fixed split", () => {
    const data = dataset({
      exercises: [exercise()],
      workouts: [
        workout({
          workout_id: "w-1",
          workout_date_local: "2026-10-20",
          session_name_snapshot: "Oberkörper A",
        }),
      ],
      sets: [set({ set_id: "s-1", workout_id: "w-1" })],
    });
    const history = buildWorkoutHistoryView(data, CONTEXT);
    expect(history.workouts[0].title).toBe("Oberkörper A");
    expect(history.total).toBe(1);
  });

  it("keeps an exercise visible after it leaves the catalog and the plan", () => {
    // The sets reference an exercise that is retired in today's catalog.
    const data = dataset({
      exercises: [exercise({ exercise_id: "ex-old", status: "retired" })],
      workouts: [workout({ workout_id: "w-1" })],
      sets: [
        set({
          set_id: "s-1",
          workout_id: "w-1",
          exercise_id: "ex-old",
          exercise_name_snapshot: "Rudern einarmig",
        }),
      ],
    });
    const history = buildWorkoutHistoryView(data, CONTEXT);
    const block = history.workouts[0].exercises[0];
    expect(block.name).toBe("Rudern einarmig");
    expect(block.retired).toBe(true);
    expect(block.in_current_catalog).toBe(true);
  });

  it("preserves left/right sets as entered instead of merging them", () => {
    const data = dataset({
      exercises: [exercise({ exercise_id: "ex-row" })],
      workouts: [workout({ workout_id: "w-1" })],
      sets: [
        set({
          set_id: "s-1",
          workout_id: "w-1",
          exercise_id: "ex-row",
          set_number: 1,
          load_kg: 20,
          reps: 10,
          execution_mode: "unilateral",
          side: "right",
        }),
        set({
          set_id: "s-2",
          workout_id: "w-1",
          exercise_id: "ex-row",
          set_number: 2,
          load_kg: 20,
          reps: 10,
          execution_mode: "unilateral",
          side: "left",
        }),
      ],
    });
    const sets = buildWorkoutHistoryView(data, CONTEXT).workouts[0].exercises[0]
      .sets;
    expect(sets.map((s) => s.side)).toEqual(["right", "left"]);
    expect(sets.every((s) => s.execution_mode === "unilateral")).toBe(true);
  });

  it("filters by date and session server-side and pages the result", () => {
    const data = dataset({
      exercises: [exercise()],
      workouts: [
        workout({ workout_id: "w-1", workout_date_local: "2026-10-01" }),
        workout({ workout_id: "w-2", workout_date_local: "2026-10-08" }),
        workout({ workout_id: "w-3", workout_date_local: "2026-10-15" }),
      ],
      sets: [
        set({ set_id: "s-1", workout_id: "w-1" }),
        set({ set_id: "s-2", workout_id: "w-2" }),
        set({ set_id: "s-3", workout_id: "w-3" }),
      ],
    });
    const windowed = buildWorkoutHistoryView(data, CONTEXT, {
      filter: { from: "2026-10-05", to: "2026-10-20" },
    });
    expect(windowed.workouts.map((w) => w.workout_id)).toEqual(["w-3", "w-2"]);
    const paged = buildWorkoutHistoryView(data, CONTEXT, { limit: 1 });
    expect(paged.workouts).toHaveLength(1);
    expect(paged.total).toBe(3);
    expect(paged.has_more).toBe(true);
  });

  it("reports an empty filter result as a notice, not as an error", () => {
    const history = buildWorkoutHistoryView(
      dataset({ exercises: [exercise()] }),
      CONTEXT,
      { filter: { from: "2030-01-01" } },
    );
    expect(history.workouts).toEqual([]);
    expect(history.notices.map((n) => n.code)).toContain("filter_empty");
  });

  it("marks a cancelled workout as not counting towards the metrics", () => {
    const data = dataset({
      exercises: [exercise()],
      workouts: [
        workout({ workout_id: "w-1", status: "cancelled" }),
        workout({ workout_id: "w-2", status: "completed" }),
      ],
      sets: [
        set({ set_id: "s-1", workout_id: "w-1" }),
        set({ set_id: "s-2", workout_id: "w-2" }),
      ],
    });
    const history = buildWorkoutHistoryView(data, CONTEXT, {
      statuses: ["completed", "cancelled"],
    });
    const byId = new Map(history.workouts.map((w) => [w.workout_id, w]));
    expect(byId.get("w-1")!.counts_towards_metrics).toBe(false);
    expect(byId.get("w-1")!.status_label).toBe("Abgebrochen");
    expect(byId.get("w-2")!.counts_towards_metrics).toBe(true);
  });
});

describe("exercise progress DTO", () => {
  const history = (entries: { date: string; kg: number; reps: number }[]) =>
    dataset({
      exercises: [
        exercise({ exercise_id: "ex-bench", name_de: "Bankdrücken" }),
      ],
      workouts: entries.map((entry, i) =>
        workout({ workout_id: `w-${i + 1}`, workout_date_local: entry.date }),
      ),
      sets: entries.map((entry, i) =>
        set({
          set_id: `s-${i + 1}`,
          workout_id: `w-${i + 1}`,
          exercise_id: "ex-bench",
          load_kg: entry.kg,
          reps: entry.reps,
        }),
      ),
    });

  it("returns chronologically sorted real measurement points", () => {
    const result = buildExerciseProgressView(
      history([
        { date: "2026-10-15", kg: 75, reps: 8 },
        { date: "2026-10-01", kg: 70, reps: 8 },
        { date: "2026-10-08", kg: 70, reps: 10 },
      ]),
      CONTEXT,
      "ex-bench",
      "max_load",
    );
    expect(result.exercise_name).toBe("Bankdrücken");
    expect(result.empty).toBe(false);
    expect(result.selected_series!.points).toEqual([
      { date: "2026-10-01", value: 70 },
      { date: "2026-10-08", value: 70 },
      { date: "2026-10-15", value: 75 },
    ]);
  });

  it("renders a single logged set as a single point", () => {
    const result = buildExerciseProgressView(
      history([{ date: "2026-10-01", kg: 70, reps: 8 }]),
      CONTEXT,
      "ex-bench",
    );
    expect(result.selected_series!.points).toHaveLength(1);
    expect(result.empty).toBe(false);
  });

  it("reports a never-logged exercise as empty with no fabricated points", () => {
    const result = buildExerciseProgressView(
      dataset({ exercises: [exercise({ exercise_id: "ex-untrained" })] }),
      CONTEXT,
      "ex-untrained",
    );
    expect(result.empty).toBe(true);
    expect(result.selected_series?.points ?? []).toEqual([]);
    // No load can be known for an exercise that was never performed.
    for (const key of [
      "max_comparable_load",
      "best_estimated_1rm",
      "last_working_load",
    ])
      expect(result.kpis.find((k) => k.key === key)!.value, key).toBeNull();
  });

  it("keeps per-implement dumbbell loads out of the 1RM comparison", () => {
    const data = dataset({
      exercises: [exercise({ exercise_id: "ex-db" })],
      workouts: [workout({ workout_id: "w-1" })],
      sets: [
        set({
          set_id: "s-1",
          workout_id: "w-1",
          exercise_id: "ex-db",
          load_kg: 20,
          reps: 10,
          load_basis: "per_implement",
          implement_count: 2,
        }),
      ],
    });
    const result = buildExerciseProgressView(
      data,
      CONTEXT,
      "ex-db",
      "estimated_1rm",
    );
    const oneRm = result.kpis.find((k) => k.key === "best_estimated_1rm")!;
    // 20 kg per implement stays 20 kg per implement: the value is reported, but
    // it carries the caveat that it is not a total load.
    expect(oneRm.value).toBeCloseTo(26.666667, 4);
    expect(oneRm.note).toBe(REASON_TEXT.value_is_per_implement);
    expect(result.variants[0].comparability.load_basis).toBe("per_implement");
    expect(result.variants[0].comparability.implement_count).toBe(2);
  });

  it("exposes every supported metric with its point count", () => {
    const result = buildExerciseProgressView(
      history([{ date: "2026-10-01", kg: 70, reps: 8 }]),
      CONTEXT,
      "ex-bench",
    );
    expect(result.available_metrics.map((m) => m.key)).toEqual([
      "max_load",
      "estimated_1rm",
      "nominal_volume",
      "total_reps",
      "mean_reps_per_working_set",
    ]);
    expect(
      result.available_metrics.every((m) => typeof m.label === "string"),
    ).toBe(true);
  });
});

describe("plans across history", () => {
  it("keeps several historical plan versions evaluable", () => {
    const data = dataset({
      exercises: [exercise()],
      plans: [
        plan({
          plan_version_id: "pv-1",
          plan_family_id: "pf-1",
          version_no: 1,
          name: "Grundplan v1",
          status: "archived",
          activated_at_utc: "2026-01-01T06:00:00Z",
          retired_at_utc: "2026-06-01T06:00:00Z",
        }),
        plan({
          plan_version_id: "pv-2",
          plan_family_id: "pf-1",
          version_no: 2,
          name: "Grundplan v2",
          status: "active",
          activated_at_utc: "2026-06-01T06:00:00Z",
        }),
      ],
      planItems: [
        planItem({
          plan_item_id: "pi-1",
          plan_version_id: "pv-1",
          session_id: "sess-1",
        }),
        planItem({
          plan_item_id: "pi-2",
          plan_version_id: "pv-2",
          session_id: "sess-1",
        }),
      ],
      workouts: [
        workout({
          workout_id: "w-old",
          workout_date_local: "2026-03-01",
          plan_version_id: "pv-1",
          session_id: "sess-1",
        }),
        workout({
          workout_id: "w-new",
          workout_date_local: "2026-09-01",
          plan_version_id: "pv-2",
          session_id: "sess-1",
        }),
      ],
      sets: [
        set({ set_id: "s-1", workout_id: "w-old", plan_item_id: "pi-1" }),
        set({ set_id: "s-2", workout_id: "w-new", plan_item_id: "pi-2" }),
      ],
    });
    const result = view(data);
    expect(result.active_plan?.plan_version_id).toBe("pv-2");
    expect(result.plan_history).toEqual([
      expect.objectContaining({ plan_version_id: "pv-1", workouts: 1 }),
      expect.objectContaining({ plan_version_id: "pv-2", workouts: 1 }),
    ]);
    const history = buildWorkoutHistoryView(data, CONTEXT, {
      filter: { plan_version_ids: ["pv-1"] },
    });
    expect(history.workouts.map((w) => w.workout_id)).toEqual(["w-old"]);
    expect(history.workouts[0].plan_name).toBe("Grundplan v1");
  });

  it("supports a spontaneous workout without any plan reference", () => {
    const data = dataset({
      exercises: [exercise()],
      workouts: [
        workout({
          workout_id: "w-free",
          plan_version_id: null,
          session_id: null,
          session_name_snapshot: null,
        }),
      ],
      sets: [
        set({
          set_id: "s-1",
          workout_id: "w-free",
          exercise_name_snapshot: "Klimmzüge",
        }),
      ],
    });
    const history = buildWorkoutHistoryView(data, CONTEXT);
    expect(history.workouts[0].plan_version_id).toBeNull();
    expect(history.workouts[0].title).toBe("Klimmzüge");
    expect(view(data).notices.map((n) => n.code)).toContain(
      "no_plan_configured",
    );
  });
});

describe("watch workouts in the history (GAR-B5-02)", () => {
  const SESSION = "9b2f6a1e-3c4d-4e5f-8a7b-1c2d3e4f5a6b";
  const watchData = () =>
    dataset({
      exercises: [
        exercise(),
        exercise({ exercise_id: "ex-row", name_de: "Rudern" }),
      ],
      plans: [plan()],
      planItems: [
        planItem({ rest_seconds: 90 }),
        planItem({
          plan_item_id: "item-2",
          exercise_id: "ex-row",
          exercise_order: 2,
          rest_seconds: null,
        }),
      ],
      workouts: [
        workout({
          workout_id: "w-watch",
          workout_date_local: "2026-01-06",
          client_session_id: SESSION,
          source: "sync",
          plan_version_id: "plan-v1",
          session_id: "session-a",
        }),
        workout({ workout_id: "w-chat", workout_date_local: "2026-01-05" }),
      ],
      sets: [
        set({ set_id: "s-1", workout_id: "w-watch", plan_item_id: "item-1" }),
        set({
          set_id: "s-2",
          workout_id: "w-watch",
          plan_item_id: "item-1",
          set_number: 2,
        }),
        set({
          set_id: "s-3",
          workout_id: "w-watch",
          plan_item_id: "item-2",
          exercise_id: "ex-row",
          exercise_name_snapshot: "Rudern",
          exercise_order: 2,
        }),
        set({
          set_id: "s-4",
          workout_id: "w-watch",
          plan_item_id: "item-2",
          exercise_id: "ex-row",
          exercise_name_snapshot: "Rudern",
          exercise_order: 2,
          set_number: 2,
        }),
        set({ set_id: "s-5", workout_id: "w-chat" }),
      ],
    });
  const timing = (
    exercise_order: number,
    set_number: number,
    rest: number | null,
  ) => ({
    exercise_order,
    set_number,
    side: "both",
    rest_before_s: rest,
  });
  const recording = (
    health: WatchRecordingData["health"],
  ): WatchRecordingData => ({
    client_session_id: SESSION,
    started_at_utc: "2026-01-06T17:00:00Z",
    ended_at_utc: "2026-01-06T17:40:00Z",
    set_timings: [
      timing(1, 1, null),
      timing(1, 2, 100),
      timing(2, 1, 150),
      timing(2, 2, null),
    ],
    health,
  });

  it("marks watch workouts and reads only the page's own recordings", () => {
    const data = watchData();
    const page = buildWorkoutHistoryView(data, CONTEXT);
    expect(
      page.workouts.map((w) => [w.workout_id, w.from_watch, w.watch]),
    ).toEqual([
      ["w-watch", true, null],
      ["w-chat", false, null],
    ]);
    expect(watchSessionsOf(page, data)).toEqual([SESSION]);
    expect(withWatchRecordings(page, data, [])).toBe(page);
  });

  it("compares each pause with the rest the watch counted down, never zero for unknown", () => {
    const data = watchData();
    const view = withWatchRecordings(
      buildWorkoutHistoryView(data, CONTEXT),
      data,
      [recording(null)],
    );
    const watch = view.workouts[0].watch!;
    expect(watch.duration_s).toBe(2400);
    // 100 s after a 90 s plan rest, 150 s into the next exercise after the
    // same 90 s; the last pause is unknown and left out.
    expect(watch.rest).toEqual({
      measured_pauses: 2,
      planned_s: 180,
      actual_s: 250,
      delta_s: 70,
      ratio_pct: (250 / 180) * 100,
    });
    expect(watch.health).toBeNull();
    expect(view.workouts[1].watch).toBeNull();
  });

  it("uses the watch default rest without a plan rest, keeps gaps and caps the curve", () => {
    const data = watchData();
    const values = Array.from({ length: 1440 }, (_, i) =>
      i % 10 === 0 ? null : 100 + (i % 50),
    );
    const view = withWatchRecordings(
      buildWorkoutHistoryView(data, CONTEXT),
      data,
      [
        {
          ...recording({
            hr: { interval_s: 5, start_utc: "2026-01-06T17:00:00Z", values },
            calories_kcal: null,
            before: { at_utc: "2026-01-06T16:59:00Z", body_battery: 0 },
            after: null,
          }),
          set_timings: [timing(2, 1, null), timing(2, 2, 130)],
        },
      ],
    );
    const watch = view.workouts[0].watch!;
    expect(watch.rest.planned_s).toBe(120);
    const health = watch.health!;
    expect(health.heart_rate_curve).toHaveLength(HEART_RATE_CURVE_POINTS);
    expect(health.heart_rate_curve[0]).toBeNull();
    expect(
      health.heart_rate_curve.every((v) => v === null || values.includes(v)),
    ).toBe(true);
    expect(health.heart_rate!.missing_seconds).toBe(144 * 5);
    expect(health.calories_kcal).toBeNull();
    // Body Battery 0 is a value; no after snapshot means no difference.
    expect(health.before).toEqual({
      body_battery: 0,
      stress: null,
      resting_hr: null,
    });
    expect(health.after).toBeNull();
    expect(health.differences).toEqual({
      body_battery: null,
      stress: null,
      resting_hr: null,
    });
  });
});
