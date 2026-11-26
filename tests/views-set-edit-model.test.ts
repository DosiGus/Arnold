/**
 * Correcting and discarding stored sets, the weight entry and the recap
 * (src/views/model) against the real tools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view";
import { MarkRecapSeenOutputSchema } from "../src/shared/recap-contract";
import {
  WorkoutContextSchema,
  WriteResponseSchema,
} from "../src/shared/workout-contract";
import { dashboardModel } from "../src/views/model/dashboard";
import { voidWeightInput } from "../src/views/model/goals";
import {
  canCorrectSets,
  setForms,
  updateSetInput,
  voidSetInput,
} from "../src/views/model/set-edit";
import { createFixturePlanning } from "../src/server/plan/fixture";
import { demoHistoryDataset } from "../src/server/plan/demo-history";
import { berlinToday, berlinYesterday } from "./fixtures/berlin-today";
import { cardServer, type CardServer } from "./fixtures/views-cards";

let server: CardServer;
beforeAll(async () => {
  server = await cardServer(
    createFixturePlanning(demoHistoryDataset(berlinYesterday())),
  );
});
afterAll(() => server.close());

const dashboard = () =>
  server.read("get_arnold_dashboard", ArnoldDashboardViewSchema, {
    timezone: "Europe/Berlin",
  });

describe("set correction", () => {
  const latest = async () => {
    const view = await dashboard();
    const id = view.recent_workouts.find(
      (w) => w.status === "completed",
    )!.workout_id;
    return server.read("get_workout", WorkoutContextSchema, { workout_id: id });
  };

  it("sends only what changed and stores it", async () => {
    const context = await latest();
    expect(canCorrectSets(context)).toBe(true);
    const form = setForms(context.sets).find((f) => f.hasWeight)!;
    expect(updateSetInput(form, form, true)).toEqual({
      ok: true,
      input: null,
    });
    expect(updateSetInput(form, { kg: form.kg, reps: "1,5" }, true).ok).toBe(
      false,
    );
    expect(updateSetInput(form, { kg: "x", reps: form.reps }, true).ok).toBe(
      false,
    );
    const built = updateSetInput(form, { kg: form.kg, reps: "3" }, true);
    if (!built.ok || !built.input) throw new Error("expected a change");
    expect(built.input).toMatchObject({
      changes: { reps: 3 },
      correct_completed: true,
    });
    const done = await server.read("update_set", WriteResponseSchema, {
      request_id: "set-edit-1",
      ...built.input,
    });
    expect(done.ok).toBe(true);
    const after = setForms((await latest()).sets).find(
      (f) => f.id === form.id,
    )!;
    expect(after).toMatchObject({ reps: "3", kg: form.kg });
  });

  it("discards a set; it leaves the list", async () => {
    const before = setForms((await latest()).sets);
    const gone = before.at(-1)!;
    const done = await server.read("void_set", WriteResponseSchema, {
      request_id: "set-void-1",
      ...voidSetInput(gone, true),
    });
    expect(done.ok).toBe(true);
    const after = setForms((await latest()).sets);
    expect(after.map((f) => f.id)).not.toContain(gone.id);
    expect(after).toHaveLength(before.length - 1);
  });

  it("offers nothing without the right to correct", async () => {
    const context = await latest();
    expect(canCorrectSets({ ...context, can_correct_completed: false })).toBe(
      false,
    );
    expect(canCorrectSets({ ...context, can_write: false })).toBe(false);
    expect(canCorrectSets({ ...context, workout: null })).toBe(false);
  });
});

describe("body weight entry", () => {
  it("discards the newest entry by its id and revision", async () => {
    await server.read("log_body_weight", WriteResponseSchema, {
      request_id: "weigh-1",
      measured_on: berlinToday(),
      timezone: "Europe/Berlin",
      weight_kg: 99,
    });
    const view = await dashboard();
    expect(view.home.latest_body_weight?.weight_kg).toBe(99);
    const done = await server.read("void_body_weight", WriteResponseSchema, {
      ...voidWeightInput(view, "weigh-void-1")!,
    });
    expect(done.ok).toBe(true);
    expect((await dashboard()).home.latest_body_weight?.weight_kg).not.toBe(99);
    expect(
      voidWeightInput(
        { ...view, home: { ...view.home, latest_body_weight: null } },
        "x",
      ),
    ).toBeNull();
  });
});

describe("recap", () => {
  it("shows a new training once, until it is marked seen", async () => {
    const context = await server.read("get_workout", WorkoutContextSchema);
    const proposal = context.proposals[0]!;
    const saved = await server.read("log_workout", WriteResponseSchema, {
      request_id: "recap-log-1",
      workout_date_local: berlinToday(),
      timezone: "Europe/Berlin",
      plan_version_id: proposal.plan_version_id,
      session_id: proposal.session_id,
    });
    expect(saved.ok).toBe(true);
    const recap = dashboardModel(await dashboard()).recap!;
    expect(recap.title).toBe(`Geschafft: ${proposal.session_name}`);
    expect(recap.detail).toMatch(/Übung.*Arbeitss/);
    await server.read("mark_recap_seen", MarkRecapSeenOutputSchema, {
      workout_id: recap.workoutId,
    });
    expect(dashboardModel(await dashboard()).recap).toBeUndefined();
  });
});
