/**
 * The history and the exercise card (src/views/model/history.ts) against the
 * real tools. Comparisons come from the analytics engine.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ArnoldDashboardViewSchema,
  ArnoldExerciseProgressViewSchema,
  ArnoldWorkoutHistoryViewSchema,
} from "../src/shared/arnold-view";
import {
  appendWorkouts,
  historyEntry,
  PROGRESS_METRICS,
  progressChoices,
  progressModel,
} from "../src/views/model/history";
import { createFixturePlanning } from "../src/server/plan/fixture";
import { demoHistoryDataset } from "../src/server/plan/demo-history";
import { berlinToday } from "./fixtures/berlin-today";
import { cardServer, type CardServer } from "./fixtures/views-cards";

let server: CardServer;
beforeAll(async () => {
  server = await cardServer(
    createFixturePlanning(demoHistoryDataset(berlinToday())),
  );
});
afterAll(() => server.close());

describe("history card", () => {
  it("lists the saved sets per exercise and adds pages without duplicates", async () => {
    const page = await server.read(
      "get_arnold_workouts",
      ArnoldWorkoutHistoryViewSchema,
      { limit: 3 },
    );
    const entry = historyEntry(page.workouts[0]!);
    expect(entry.exercises.length).toBeGreaterThan(0);
    expect(entry.exercises[0]!.line).toMatch(/×/);
    expect(entry.meta).toContain("Übung");
    expect(entry.record).toBe(false);
    expect(appendWorkouts(page.workouts, page.workouts)).toHaveLength(
      page.workouts.length,
    );
  });
});

describe("exercise card", () => {
  it("shows every metric with its value, unit and curve", async () => {
    const view = await server.read(
      "get_arnold_dashboard",
      ArnoldDashboardViewSchema,
    );
    const exercise = progressChoices(view)[0]!.value;
    for (const { value } of PROGRESS_METRICS) {
      const m = progressModel(
        await server.read(
          "get_arnold_exercise_progress",
          ArnoldExerciseProgressViewSchema,
          { exercise_id: exercise, metric: value },
        ),
      );
      expect(m.value).toMatch(/(kg|Wdh\.)$|^–$/);
      expect(m.caption).toBeTruthy();
    }
  });

  it("says why a value is missing instead of showing 0", async () => {
    const view = await server.read(
      "get_arnold_dashboard",
      ArnoldDashboardViewSchema,
    );
    const exercise = progressChoices(view)[0]!.value;
    const progress = await server.read(
      "get_arnold_exercise_progress",
      ArnoldExerciseProgressViewSchema,
      { exercise_id: exercise, from: "2000-01-01", to: "2000-01-02" },
    );
    const m = progressModel(progress);
    expect(m.value).toBe("–");
    expect(m.points).toEqual([]);
    expect(m.notes.length).toBeGreaterThan(0);
  });
});
