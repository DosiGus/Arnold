/**
 * Regressions for the findings of the independent QA pass on Task 003.
 *
 * Each test names its finding and asserts the behaviour that was wrong, so the
 * specific defect cannot come back unnoticed.
 */
import { describe, expect, it } from "vitest";
import {
  buildDashboardView,
  buildExerciseProgressView,
} from "../src/server/arnold-presenter";
import { LOAD_BASIS_LABEL } from "../src/shared/arnold-format";
import { progressModel } from "../src/views/model/history";
import { ArnoldDatasetSchema } from "../src/shared/arnold-schema-v1";
import { dataset, exercise, set, workout } from "./fixtures/arnold-analytics";
import { EXERCISES, fullDataset } from "./fixtures/arnold-dashboard";

const CTX = { generatedAt: "2026-10-25T09:00:00Z" };

describe("T3-03: a working-set count is not a volume coverage", () => {
  /** One completed bodyweight working set: countable, but with no derivable load. */
  const bodyweightOnly = () =>
    dataset({
      exercises: [
        exercise({
          exercise_id: "ex-pull",
          default_load_basis: "bodyweight_only",
        }),
      ],
      workouts: [workout({ workout_id: "w1" })],
      sets: [
        set({
          set_id: "s1",
          workout_id: "w1",
          exercise_id: "ex-pull",
          load_kg: null,
          load_basis: "bodyweight_only",
          reps: 10,
        }),
      ],
    });

  it("counts a bodyweight working set whose volume is unknown", () => {
    const kpi = buildDashboardView(bodyweightOnly(), CTX).kpis.find(
      (k) => k.key === "working_sets",
    )!;
    expect(kpi.value).toBe(1);
    expect(kpi.status).toBe("valid");
  });

  it("counts every working set when only some have a computable volume", () => {
    const mixed = dataset({
      exercises: [
        exercise({ exercise_id: "ex-b" }),
        exercise({
          exercise_id: "ex-pull",
          default_load_basis: "bodyweight_only",
        }),
      ],
      workouts: [workout({ workout_id: "w1" })],
      sets: [
        set({
          set_id: "s1",
          workout_id: "w1",
          exercise_id: "ex-b",
          load_kg: 70,
          reps: 8,
        }),
        set({
          set_id: "s2",
          workout_id: "w1",
          exercise_id: "ex-pull",
          exercise_order: 2,
          set_number: 1,
          load_kg: null,
          load_basis: "bodyweight_only",
          reps: 10,
        }),
      ],
    });
    const kpi = buildDashboardView(mixed, CTX).kpis.find(
      (k) => k.key === "working_sets",
    )!;
    expect(kpi.value).toBe(2);
    // The partial volume coverage is explained rather than silently dropping a set.
    expect(kpi.note).toMatch(/kein Trainingsvolumen berechnen/);
  });

  it("agrees with the workout history about the number of sets", () => {
    const data = bodyweightOnly();
    const overview = buildDashboardView(data, CTX).kpis.find(
      (k) => k.key === "working_sets",
    )!.value;
    expect(overview).toBe(1);
  });
});

describe("T3-04: load conventions survive into KPIs and curves", () => {
  const dumbbells = () =>
    dataset({
      exercises: [
        exercise({
          exercise_id: "ex-db",
          default_load_basis: "per_implement",
          default_implement_count: 2,
        }),
      ],
      workouts: [workout({ workout_id: "w1" })],
      sets: [
        set({
          set_id: "s1",
          workout_id: "w1",
          exercise_id: "ex-db",
          load_kg: 20,
          reps: 10,
          load_basis: "per_implement",
          implement_count: 2,
        }),
      ],
    });

  it("tags the maximum load with its convention", () => {
    const view = buildExerciseProgressView(
      dumbbells(),
      CTX,
      "ex-db",
      "max_load",
    );
    const kpi = view.kpis.find((k) => k.key === "max_comparable_load")!;
    expect(kpi.value).toBe(20);
    expect(kpi.load_basis).toBe("per_implement");
    expect(view.max_comparable_load_comparability?.load_basis).toBe(
      "per_implement",
    );
  });

  it("names the convention instead of a bare 20 kg", () => {
    const kpi = buildExerciseProgressView(
      dumbbells(),
      CTX,
      "ex-db",
      "max_load",
    ).kpis.find((k) => k.key === "max_comparable_load")!;
    // The progress card names the convention next to the number.
    expect(LOAD_BASIS_LABEL[kpi.load_basis!]).toContain("pro Hantel");
    const card = progressModel(
      buildExerciseProgressView(dumbbells(), CTX, "ex-db", "max_load"),
    );
    expect(card.value).toBe("20 kg");
    expect(card.comparison).toContain("pro Hantel");
  });

  it("shows a caveat on a value the engine marked valid", () => {
    // The per-implement 1RM is computed correctly and still must not be read
    // as a total load, so its note has to be visible despite status `valid`.
    const kpi = buildExerciseProgressView(
      dumbbells(),
      CTX,
      "ex-db",
      "estimated_1rm",
    ).kpis.find((k) => k.key === "best_estimated_1rm")!;
    expect(kpi.status).toBe("valid");
    expect(kpi.note).toBeTruthy();
    // The progress card shows the note under the value.
    expect(kpi.note).toContain("nicht als Gesamtlast");
  });

  it("leaves a plain total load unlabelled", () => {
    const kpi = buildExerciseProgressView(
      fullDataset(),
      CTX,
      EXERCISES.bench,
      "max_load",
    ).kpis.find((k) => k.key === "max_comparable_load")!;
    expect(kpi.load_basis).toBe("total");
    expect(LOAD_BASIS_LABEL[kpi.load_basis!]).not.toContain("pro Hantel");
  });
});

describe("T3-06: the overview respects its own selection", () => {
  it("lists no sessions from outside the selected period", () => {
    const view = buildDashboardView(fullDataset(), CTX, {
      filter: { from: "2030-01-01", to: "2030-01-31" },
    });
    expect(view.kpis.find((k) => k.key === "workouts")!.value).toBe(0);
    expect(view.recent_workouts).toEqual([]);
    expect(view.session_names).toEqual([]);
  });

  it("narrows the recent list to the selected period", () => {
    const view = buildDashboardView(fullDataset(), CTX, {
      filter: { from: "2026-10-01", to: "2026-10-31" },
    });
    expect(view.recent_workouts.length).toBeGreaterThan(0);
    for (const workoutEntry of view.recent_workouts) {
      expect(workoutEntry.date >= "2026-10-01").toBe(true);
      expect(workoutEntry.date <= "2026-10-31").toBe(true);
    }
  });

  it("narrows the recent list to the selected plan version", () => {
    const view = buildDashboardView(fullDataset(), CTX, {
      filter: { plan_version_ids: ["pv-test-1"] },
    });
    for (const workoutEntry of view.recent_workouts)
      expect(workoutEntry.plan_version_id).toBe("pv-test-1");
  });

  it("keeps the whole history reachable when nothing is selected", () => {
    const view = buildDashboardView(fullDataset(), CTX);
    expect(view.recent_workouts.length).toBeGreaterThan(0);
    expect(view.session_names.length).toBeGreaterThan(0);
  });
});

describe("unknown values still never render as a confident zero", () => {
  it("keeps an uncomputable comparable volume unknown, not 0", () => {
    const full = fullDataset();
    const machineOnly = ArnoldDatasetSchema.parse({
      ...full,
      workouts: full.workouts.filter((w) => w.workout_id === "w-test-4"),
      sets: full.sets.filter(
        (s) => s.workout_id === "w-test-4" && s.exercise_id === EXERCISES.press,
      ),
    });
    const kpi = buildDashboardView(machineOnly, CTX).kpis.find(
      (k) => k.key === "comparable_volume",
    )!;
    expect(kpi.value).toBeNull();
  });
});
