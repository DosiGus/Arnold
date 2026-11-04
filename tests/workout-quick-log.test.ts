import { describe, expect, it } from "vitest";
import { createFixtureLogging } from "../src/server/workout/fixture";
import { proposeActivePlan } from "../src/server/workout/proposal";
import { buildArnoldDashboardAnalytics } from "../src/analytics";
import {
  WriteResponseSchema,
  type WriteResponse,
} from "../src/shared/workout-contract";

function ok(response: WriteResponse) {
  expect(response.error).toBeNull();
  expect(response.ok).toBe(true);
  WriteResponseSchema.parse(response);
  return response.result!;
}
function code(response: WriteResponse, expected: string) {
  expect(response.ok).toBe(false);
  expect(response.error?.code).toBe(expected);
  WriteResponseSchema.parse(response);
  return response.error!;
}
const base = (extra: Record<string, unknown> = {}) => ({
  request_id: crypto.randomUUID(),
  workout_date_local: "2026-10-20",
  timezone: "Europe/Berlin",
  plan_version_id: "fixture-plan-v1",
  session_id: "fixture-push",
  source: "ui",
  ...extra,
});
/** The fixture plan has no target weights, so the first time needs them. */
const firstTime = (extra: Record<string, unknown> = {}) =>
  base({
    exercises: [
      { plan_item_id: "fixture-item-1", load_kg: 60 },
      { plan_item_id: "fixture-item-2", load_kg: 20 },
    ],
    ...extra,
  });
const completed = async (r: ReturnType<typeof createFixtureLogging>) =>
  buildArnoldDashboardAnalytics(await r.store.read()).activity
    .completed_workouts.value;

describe("log_workout: a whole workout in one step", () => {
  it("names the missing weight instead of guessing and stores nothing", async () => {
    const r = createFixtureLogging();
    const error = code(
      await r.service.execute("log_workout", base()),
      "VALIDATION_ERROR",
    );
    expect(error.message).toContain("Demo Bankdrücken (Gewicht)");
    expect(error.message).toContain("Demo Schrägbankdrücken (Gewicht)");
    expect((await r.store.read()).workouts).toHaveLength(0);
  });

  it("saves the plan with given weights as one completed workout", async () => {
    const r = createFixtureLogging();
    const result = ok(await r.service.execute("log_workout", firstTime()));
    expect(result.workout).toMatchObject({
      status: "completed",
      session_name_snapshot: "Demo Push",
      plan_version_id: "fixture-plan-v1",
      session_id: "fixture-push",
      source: "ui",
    });
    expect(result.sets).toHaveLength(6);
    const incline = result.sets.filter(
      (s) => s.exercise_id === "fixture-incline",
    );
    expect(incline.map((s) => s.set_number)).toEqual([1, 2, 3]);
    expect(incline[0]).toMatchObject({
      reps: 12,
      load_kg: 20,
      load_basis: "per_implement",
      implement_count: 2,
      plan_item_id: "fixture-item-2",
      exercise_order: 2,
      set_type: "working",
    });
    expect(await completed(r)).toBe(1);
  });

  it("repeats last time without any changes", async () => {
    const r = createFixtureLogging();
    ok(
      await r.service.execute(
        "log_workout",
        firstTime({
          exercises: [
            {
              plan_item_id: "fixture-item-1",
              sets: [
                { reps: 10, load_kg: 60 },
                { reps: 9, load_kg: 60 },
                { reps: 8, load_kg: 60 },
              ],
            },
            { plan_item_id: "fixture-item-2", load_kg: 20 },
          ],
        }),
      ),
    );
    const proposal = proposeActivePlan(await r.store.read())[0];
    expect(proposal.exercises[0]).toMatchObject({
      source: "last_time",
      last_date: "2026-10-20",
      missing: [],
    });
    const again = ok(
      await r.service.execute(
        "log_workout",
        base({ workout_date_local: "2026-10-22" }),
      ),
    );
    expect(
      again.sets
        .filter((s) => s.exercise_id === "fixture-bench")
        .map((s) => [s.reps, s.load_kg]),
    ).toEqual([
      [10, 60],
      [9, 60],
      [8, 60],
    ]);
    expect(await completed(r)).toBe(2);
  });

  it("swaps, skips and adds exercises for this day only", async () => {
    const r = createFixtureLogging();
    const result = ok(
      await r.service.execute(
        "log_workout",
        base({
          exercises: [
            { plan_item_id: "fixture-item-1", exercise_id: "fixture-pullup" },
            { plan_item_id: "fixture-item-2", skip: true },
            {
              exercise_id: "fixture-row",
              set_count: 2,
              reps: 10,
              load_kg: 22,
            },
          ],
        }),
      ),
    );
    const pullups = result.sets.filter(
      (s) => s.exercise_id === "fixture-pullup",
    );
    // The swapped exercise keeps the planned volume but not the plan slot.
    expect(pullups).toHaveLength(3);
    expect(pullups[0]).toMatchObject({
      plan_item_id: null,
      load_kg: null,
      load_basis: "bodyweight_only",
      reps: 12,
    });
    const rows = result.sets.filter((s) => s.exercise_id === "fixture-row");
    expect(rows.map((s) => [s.side, s.set_number])).toEqual([
      ["left", 1],
      ["right", 1],
      ["left", 2],
      ["right", 2],
    ]);
    expect(rows[0]).toMatchObject({ reps_basis: "per_side", load_kg: 22 });
    expect(result.sets.some((s) => s.exercise_id === "fixture-incline")).toBe(
      false,
    );
  });

  it("asks for a weight when a swapped exercise has none yet", async () => {
    const r = createFixtureLogging();
    const error = code(
      await r.service.execute(
        "log_workout",
        firstTime({
          exercises: [
            { plan_item_id: "fixture-item-1", exercise_id: "fixture-row" },
            { plan_item_id: "fixture-item-2", load_kg: 20 },
          ],
        }),
      ),
      "VALIDATION_ERROR",
    );
    expect(error.message).toContain("Demo Rudern einarmig (Gewicht)");
  });

  it("refuses a weight on a bodyweight exercise and future dates", async () => {
    const r = createFixtureLogging();
    code(
      await r.service.execute(
        "log_workout",
        base({
          exercises: [
            {
              plan_item_id: "fixture-item-1",
              exercise_id: "fixture-pullup",
              load_kg: 10,
            },
            { plan_item_id: "fixture-item-2", skip: true },
          ],
        }),
      ),
      "VALIDATION_ERROR",
    );
    code(
      await r.service.execute(
        "log_workout",
        firstTime({ workout_date_local: "2999-01-01" }),
      ),
      "DATE_IN_FUTURE",
    );
  });

  it("replays the same request without a second workout", async () => {
    const r = createFixtureLogging();
    const input = firstTime();
    ok(await r.service.execute("log_workout", input));
    const replay = await r.service.execute("log_workout", input);
    expect(replay.replayed).toBe(true);
    expect((await r.store.read()).workouts).toHaveLength(1);
  });

  it("replaces a saved workout in one step when it is edited", async () => {
    const r = createFixtureLogging();
    const first = ok(await r.service.execute("log_workout", firstTime()));
    const edited = ok(
      await r.service.execute(
        "log_workout",
        firstTime({
          replaces_workout_id: first.workout!.workout_id,
          expected_row_revision: 1,
          exercises: [
            { plan_item_id: "fixture-item-1", load_kg: 65 },
            { plan_item_id: "fixture-item-2", load_kg: 20 },
          ],
        }),
      ),
    );
    const data = await r.store.read();
    expect(
      data.workouts.find((w) => w.workout_id === first.workout!.workout_id),
    ).toMatchObject({ status: "voided", row_revision: 2 });
    expect(
      data.sets
        .filter((s) => s.workout_id === first.workout!.workout_id)
        .every((s) => s.status === "voided"),
    ).toBe(true);
    expect(edited.sets[0].load_kg).toBe(65);
    expect(edited.warnings).toEqual([]);
    expect(await completed(r)).toBe(1);
  });

  it("asks before saving the same session twice on one day", async () => {
    const r = createFixtureLogging();
    const first = ok(await r.service.execute("log_workout", firstTime()));
    const error = code(
      await r.service.execute("log_workout", firstTime()),
      "DUPLICATE_WORKOUT",
    );
    expect(error.message).toContain(first.workout!.workout_id);
    expect(error.message).toContain("replaces_workout_id");
    expect((await r.store.read()).workouts).toHaveLength(1);
    // Another day, or an explicit yes, is fine.
    ok(
      await r.service.execute(
        "log_workout",
        firstTime({ workout_date_local: "2026-10-21" }),
      ),
    );
    const second = ok(
      await r.service.execute(
        "log_workout",
        firstTime({ confirm_duplicate: true }),
      ),
    );
    expect(second.warnings[0]).toContain("2 Trainings „Demo Push“");
  });

  it("never carries a weight over to a swapped or added exercise", async () => {
    const r = createFixtureLogging();
    // History: rows with 22 kg per dumbbell.
    ok(
      await r.service.execute(
        "log_workout",
        firstTime({
          workout_date_local: "2026-10-18",
          exercises: [
            { plan_item_id: "fixture-item-1", load_kg: 60 },
            { plan_item_id: "fixture-item-2", load_kg: 20 },
            { exercise_id: "fixture-row", set_count: 2, reps: 10, load_kg: 22 },
          ],
        }),
      ),
    );
    const swapped = code(
      await r.service.execute(
        "log_workout",
        base({
          exercises: [
            { plan_item_id: "fixture-item-1", exercise_id: "fixture-row" },
          ],
        }),
      ),
      "VALIDATION_ERROR",
    );
    expect(swapped.message).toContain("Demo Rudern einarmig (Gewicht)");
    const added = code(
      await r.service.execute(
        "log_workout",
        base({
          exercises: [{ exercise_id: "fixture-row", set_count: 3, reps: 12 }],
        }),
      ),
      "VALIDATION_ERROR",
    );
    expect(added.message).toContain("Demo Rudern einarmig (Gewicht)");
    // Named, it is saved as said.
    const saved = ok(
      await r.service.execute(
        "log_workout",
        base({
          exercises: [
            { exercise_id: "fixture-row", set_count: 3, reps: 12, load_kg: 24 },
          ],
        }),
      ),
    );
    expect(
      saved.sets
        .filter((s) => s.exercise_id === "fixture-row")
        .every((s) => s.load_kg === 24 && s.reps === 12),
    ).toBe(true);
  });
});

describe("void_workout: taking a saved workout back", () => {
  it("voids the workout and its sets, never deletes, checks the revision", async () => {
    const r = createFixtureLogging();
    const saved = ok(await r.service.execute("log_workout", firstTime()));
    code(
      await r.service.execute("void_workout", {
        request_id: "stale",
        workout_id: saved.workout!.workout_id,
        expected_row_revision: 7,
        correction_reason: "Versehentlich eingetragen",
      }),
      "REVISION_CONFLICT",
    );
    const voided = ok(
      await r.service.execute("void_workout", {
        request_id: "undo",
        workout_id: saved.workout!.workout_id,
        expected_row_revision: 1,
        correction_reason: "Versehentlich eingetragen",
      }),
    );
    expect(voided.workout?.status).toBe("voided");
    expect(voided.sets).toHaveLength(6);
    const data = await r.store.read();
    expect(data.sets).toHaveLength(6);
    expect(data.sets.every((s) => s.status === "voided")).toBe(true);
    expect(await completed(r)).toBe(0);
    code(
      await r.service.execute("void_workout", {
        request_id: "again",
        workout_id: saved.workout!.workout_id,
        expected_row_revision: 2,
        correction_reason: "Nochmal",
      }),
      "INVALID_STATUS_TRANSITION",
    );
  });
});
