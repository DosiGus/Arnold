/**
 * Rückblick selection (UX-006): only a real, recent, completed workout; records,
 * weekly goal and suggestion only when the engine delivers them.
 */
import { describe, expect, it } from "vitest";
import { computeRecap, newestWorkout } from "../src/analytics/recap";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { demoHistoryDataset } from "../src/server/plan/demo-history";
import { proposeActivePlan } from "../src/server/workout/proposal";
import { emptyTrackerDataset } from "./fixtures/arnold-dashboard";

const TODAY = "2026-11-03";
const dataset = demoHistoryDataset(TODAY);
const view = buildDashboardView(
  dataset,
  { generatedAt: "2026-11-03T18:00:00Z" },
  { reference_date: TODAY },
);
const recap = (reference: string | null, home = view.home) =>
  computeRecap(dataset, home, proposeActivePlan(dataset), reference);

describe("recap selection", () => {
  it("picks the newest completed workout of the last seven days", () => {
    const core = recap(TODAY)!;
    expect(core).not.toBeNull();
    const newest = [...dataset.workouts]
      .filter((w) => w.status === "completed")
      .sort((a, b) => (a.workout_date_local < b.workout_date_local ? -1 : 1))
      .at(-1)!;
    expect(core.workout_id).toBe(newest.workout_id);
    expect(core.date).toBe(newest.workout_date_local);
  });

  it("never shows a recap without a real new workout", () => {
    expect(recap(null)).toBeNull();
    // The newest workout is older than a week.
    expect(recap("2026-12-31")).toBeNull();
    // Nothing trained at all.
    const empty = emptyTrackerDataset();
    expect(newestWorkout(empty, TODAY)).toBeNull();
    // A workout that is not completed is no new training.
    const open = {
      workouts: dataset.workouts.map((w) => ({
        ...w,
        status: "in_progress" as const,
      })),
    };
    expect(newestWorkout(open, TODAY)).toBeNull();
  });

  it("lists records only when the server delivers them, and only of this workout", () => {
    const core = recap(TODAY)!;
    expect(core.records.length).toBeGreaterThan(0);
    for (const r of core.records)
      expect(
        view.home.records.some(
          (h) =>
            h.workout_id === core.workout_id && h.exercise_id === r.exercise_id,
        ),
      ).toBe(true);
    expect(core.records.length).toBeLessThanOrEqual(3);
    const none = recap(TODAY, { ...view.home, records: [] })!;
    expect(none.records).toEqual([]);
  });

  it("shows the weekly goal only for the workout that reached it", () => {
    // The streak as the engine would report it for another weekly goal.
    const withGoal = (goal: number | null) => ({
      ...view.home,
      streak: {
        ...view.home.streak,
        weekly_goal: goal,
        weeks: view.home.streak.weeks.map((w) => ({
          ...w,
          goal_met: goal !== null && w.training_days >= goal,
        })),
      },
    });
    // Monday and Tuesday are trained: the second day reaches a goal of two.
    expect(recap(TODAY, withGoal(2))!.week_goal).toEqual({
      goal: 2,
      training_days: 2,
    });
    // A goal of one was reached by the first day, not by this workout.
    expect(recap(TODAY, withGoal(1))!.week_goal).toBeNull();
    // Not reached yet, or no goal at all: nothing is claimed.
    expect(recap(TODAY, withGoal(5))!.week_goal).toBeNull();
    expect(recap(TODAY, withGoal(null))!.week_goal).toBeNull();
  });

  it("takes the suggestion from the server's progression, at most one", () => {
    const core = recap(TODAY)!;
    expect(core.suggestion).not.toBeNull();
    {
      expect(["increase", "reduce", "more_reps"]).toContain(
        core.suggestion!.decision,
      );
      const proposal = proposeActivePlan(dataset)
        .flatMap((p) => p.exercises)
        .find((e) => e.exercise_id === core.suggestion!.exercise_id)!;
      expect(proposal.source).toBe("progression");
      expect(core.suggestion!.next_reps).toBe(proposal.sets[0].reps);
    }
    // Without progression there is no suggestion.
    const bare = computeRecap(dataset, view.home, [], TODAY)!;
    expect(bare.suggestion).toBeNull();
    expect(bare.next_session_id).toBeNull();
  });
});
