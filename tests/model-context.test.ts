/**
 * What the cards tell the model. The texts are built from stored data and the
 * engine's own results, so these tests check wording and completeness, and
 * that no internal identifier leaks into what the model may repeat.
 */
import { describe, expect, it } from "vitest";
import { buildDashboardView } from "../src/server/arnold-presenter";
import {
  finishMessage,
  homeContext,
  pageContext,
  runningContext,
  savedContext,
  todayContext,
} from "../src/ui/model-context";
import { EXERCISES, fullDataset } from "./fixtures/arnold-dashboard";

const CONTEXT = { generatedAt: "2026-10-25T09:00:00Z" };
const INTERNAL = [
  "per_implement",
  "bodyweight_only",
  "bilateral_simultaneous",
  "unilateral",
  "machine_display",
];

describe("model context", () => {
  const dataset = fullDataset();
  const view = buildDashboardView(dataset, CONTEXT);
  const exercises = new Map(dataset.exercises.map((e) => [e.exercise_id, e]));
  const workout = dataset.workouts.find((w) => w.workout_id === "w-test-3")!;
  const sets = dataset.sets.filter((s) => s.workout_id === workout.workout_id);

  it("lists every saved set with its own convention and its set_id", () => {
    const text = savedContext({ workout, sets, editing: false });
    expect(text).toContain("gespeichertes Training");
    expect(text).toContain(`workout_id ${workout.workout_id}`);
    expect(text).toContain("20 kg pro Hantel");
    for (const set of sets.filter((s) => s.status === "active"))
      expect(text).toContain(`set_id ${set.set_id}`);
    expect(text).toContain("update_set");
    expect(text).toContain("void_workout");
    for (const token of INTERNAL) expect(text, token).not.toContain(token);
  });

  it("tells the model how a running workout continues", () => {
    const text = runningContext({
      workout: { ...workout, status: "in_progress" },
      sets: [],
    });
    expect(text).toContain("laufendes Training");
    expect(text).toContain("Noch kein Satz gespeichert");
    expect(text).toContain("log_workout_sets");
  });

  it("reports the start screen with the engine's numbers", () => {
    const text = homeContext(view);
    expect(text).toContain("Startansicht");
    expect(text).toContain("nicht wiederholen");
  });

  it("finishes with one short line from the engine's summary", () => {
    const summary = view.recent_workouts.find(
      (w) => w.workout_id === workout.workout_id,
    );
    const record = view.records.find((r) => r.kind === "improvement");
    const message = finishMessage({ workout, summary, record });
    expect(message).toMatch(/^Training gespeichert: /);
    expect(message).toMatch(/\d+ Arbeitss(atz|ätze)/);
    expect(message).toContain("neuer Rekord");
    expect(message.split("\n")).toHaveLength(1);
    // Without the engine's numbers the message names only the workout.
    expect(finishMessage({ workout })).toBe(
      `Training gespeichert: ${workout.session_name_snapshot}.`,
    );
  });

  it("describes today's card with the IDs log_workout needs", () => {
    const text = todayContext({
      proposal: {
        plan_version_id: "plan-1",
        session_id: "push",
        session_name: "Push",
        session_order: 1,
        exercises: [
          {
            plan_item_id: "item-1",
            exercise_id: "bench",
            exercise_name: "Bankdrücken",
            conventions: {
              load_basis: "total",
              execution_mode: "bilateral_simultaneous",
              implement_count: 1,
              reps_basis: "total",
            },
            sets: [{ reps: 8, load_kg: 75, side: "both" }],
            source: "last_time",
            last_date: "2026-10-20",
            target_sets: 1,
            rep_min: 6,
            rep_max: 8,
            missing: [],
          },
          {
            plan_item_id: "item-2",
            exercise_id: "incline",
            exercise_name: "Schrägbankdrücken",
            conventions: {
              load_basis: "per_implement",
              execution_mode: "bilateral_simultaneous",
              implement_count: 2,
              reps_basis: "total",
            },
            sets: [{ reps: 10, load_kg: null, side: "both" }],
            source: "plan",
            last_date: null,
            target_sets: 1,
            rep_min: 8,
            rep_max: 10,
            missing: ["load"],
          },
        ],
      },
      planName: "Testplan",
      of: 3,
      editing: false,
      canWrite: true,
    });
    expect(text).toContain("„Push“ aus dem Plan „Testplan“, Tag 1 von 3");
    expect(text).toContain("session_id push");
    expect(text).toContain(
      "- Bankdrücken [plan_item_id item-1, exercise_id bench]: 75 kg × 8 (wie am",
    );
    expect(text).toContain("fehlt: Gewicht");
    expect(text).toContain("log_workout");
    for (const token of INTERNAL) expect(text, token).not.toContain(token);
    expect(pageContext("progress")).toContain("Fortschritt");
  });
});
