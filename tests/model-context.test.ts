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
  summaryContext,
  todayContext,
  workoutContext,
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
    const text = workoutContext({
      workout: { ...workout, status: "in_progress" },
      sets,
      exercises,
      items: [],
      current: EXERCISES.row,
      pending: false,
    });
    expect(text).toContain("laufendes Training");
    expect(text).toContain(`workout_id ${workout.workout_id}`);
    expect(text).toContain("20 kg pro Hantel");
    for (const set of sets.filter((s) => s.status === "active"))
      expect(text).toContain(`set_id ${set.set_id}`);
    expect(text).toContain("update_set");
    for (const token of INTERNAL) expect(text, token).not.toContain(token);
  });

  it("warns the model while a save is unconfirmed", () => {
    const text = workoutContext({
      workout,
      sets: [],
      exercises,
      items: [],
      pending: true,
    });
    expect(text).toContain("Noch kein Satz gespeichert");
    expect(text).toContain("unbestätigt");
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
    expect(message).toMatch(/^Training beendet: /);
    expect(message).toMatch(/\d+ Arbeitss(atz|ätze)/);
    expect(message).toContain("neuer Rekord");
    expect(message.split("\n")).toHaveLength(1);
    // Without the engine's numbers the message names only the workout.
    expect(finishMessage({ workout })).toBe(
      `Training beendet: ${workout.session_name_snapshot}.`,
    );
    expect(summaryContext({ workout })).toContain("noch aktualisiert");
  });

  it("describes today's card and the other views", () => {
    const text = todayContext({
      sessionName: "Push",
      planName: "Testplan",
      day: { order: 1, of: 3 },
      exercises: [{ name: "Bankdrücken", target: "4 × 6–8 · 75 kg" }],
      canWrite: true,
    });
    expect(text).toContain("„Push“ aus dem Plan „Testplan“, Tag 1 von 3");
    expect(text).toContain("- Bankdrücken: 4 × 6–8 · 75 kg");
    expect(pageContext("progress")).toContain("Fortschritt");
  });
});
