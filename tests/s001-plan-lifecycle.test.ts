import { expect, it } from "vitest";
import { ArnoldDatasetSchema } from "../src/shared/arnold-schema-v1";
import {
  createFixturePlanning,
  planFixtureDataset,
} from "../src/server/plan/fixture";
import { canonical } from "../src/server/workout/infrastructure";
import { buildArnoldDashboardAnalytics } from "../src/analytics";
import { session } from "./fixtures/arnold-plan";

it("creates, validates, confirms, logs, completes and versions a plan without rewriting raw history", async () => {
  let instant = Date.parse("2026-10-27T10:00:00Z");
  const r = createFixturePlanning(planFixtureDataset("empty"), {
    clock: () => new Date(instant),
  });
  const created = await r.plans.execute("create_training_plan", {
    request_id: "create",
    name: "Individuell",
    split_key: "Freie Struktur",
    sessions: [session("Individuelle Einheit")],
  });
  expect(created.ok).toBe(true);
  const v1 = created.result!.plan!.version;
  expect(
    (await r.plans.validate({ plan_version_id: v1.plan_version_id }))
      .activatable,
  ).toBe(true);
  expect(
    (
      await r.plans.execute("activate_training_plan", {
        request_id: "unconfirmed",
        plan_version_id: v1.plan_version_id,
        expected_row_revision: v1.row_revision,
      })
    ).error?.code,
  ).toBe("VALIDATION_ERROR");
  const activate = (id: string, revision: number, request_id: string) =>
    r.plans.execute("activate_training_plan", {
      request_id,
      plan_version_id: id,
      expected_row_revision: revision,
      confirmation: {
        plan_version_id: id,
        row_revision: revision,
        confirmed: true,
      },
    });
  expect(
    (await activate(v1.plan_version_id, v1.row_revision, "act-v1")).ok,
  ).toBe(true);
  const start = await r.service.startWorkout({
    request_id: "start",
    workout_date_local: "2026-10-27",
    timezone: "Europe/Berlin",
    session_name: "Individuelle Einheit",
  });
  const workout = start.result!.workout!;
  expect(workout.plan_version_id).toBe(v1.plan_version_id);
  const item = v1.sessions[0].exercises[0];
  const inputs = [
    {
      exercise_id: "plan-fx-bench",
      plan_item_id: item.plan_item_id,
      load_kg: 70,
      load_basis: "total",
      implement_count: 1,
      execution_mode: "bilateral_simultaneous",
      side: "both",
      reps_basis: "total",
    },
    {
      exercise_id: "plan-fx-db-bench",
      load_kg: 20,
      load_basis: "per_implement",
      implement_count: 2,
      execution_mode: "bilateral_simultaneous",
      side: "both",
      reps_basis: "total",
    },
    {
      exercise_id: "plan-fx-row",
      load_kg: 30,
      load_basis: "per_implement",
      implement_count: 1,
      execution_mode: "unilateral",
      side: "left",
      reps_basis: "total",
    },
    {
      exercise_id: "plan-fx-row",
      load_kg: 32,
      load_basis: "per_implement",
      implement_count: 1,
      execution_mode: "unilateral",
      side: "right",
      reps_basis: "total",
    },
    {
      exercise_id: "plan-fx-pullup",
      load_kg: null,
      load_basis: "bodyweight_only",
      implement_count: 1,
      execution_mode: "bilateral_simultaneous",
      side: "both",
      reps_basis: "total",
    },
    {
      exercise_id: "plan-fx-pullup",
      load_kg: 15,
      load_basis: "assistance",
      implement_count: 1,
      execution_mode: "bilateral_simultaneous",
      side: "both",
      reps_basis: "total",
    },
    {
      exercise_id: "plan-fx-curl",
      load_kg: 12,
      load_basis: "per_implement",
      implement_count: 2,
      execution_mode: "alternating",
      side: "alternating",
      reps_basis: "per_side",
    },
  ];
  expect(
    (
      await r.service.logWorkoutSets({
        request_id: "log",
        workout_id: workout.workout_id,
        sets: inputs.map((input) => ({
          ...input,
          reps: 10,
          set_type: "working",
        })),
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await r.service.completeWorkout({
        request_id: "complete",
        workout_id: workout.workout_id,
        expected_row_revision: workout.row_revision,
        ended_at_utc: "2026-10-27T12:00:00Z",
      })
    ).ok,
  ).toBe(true);
  const historic = await r.repository.read();
  const cloned = (
    await r.plans.execute("create_plan_version", {
      request_id: "clone",
      source_plan_version_id: v1.plan_version_id,
    })
  ).result!.plan!.version;
  const edited = await r.plans.execute("update_plan_draft", {
    request_id: "replace",
    plan_version_id: cloned.plan_version_id,
    expected_row_revision: cloned.row_revision,
    edits: [
      {
        type: "replace_plan_exercise",
        plan_item_id: cloned.sessions[0].exercises[0].plan_item_id,
        new_exercise_id: "plan-fx-db-bench",
      },
      {
        type: "rename_session",
        session_id: cloned.sessions[0].session_id,
        session_name: "Neue Einheit",
      },
    ],
  });
  expect(edited.ok).toBe(true);
  instant += 1000;
  expect(
    (
      await activate(
        cloned.plan_version_id,
        edited.result!.plan!.version.row_revision,
        "act-v2",
      )
    ).ok,
  ).toBe(true);
  const after = ArnoldDatasetSchema.parse(await r.repository.read());
  expect(canonical(after.workouts)).toBe(canonical(historic.workouts));
  expect(canonical(after.sets)).toBe(canonical(historic.sets));
  const newWorkout = (
    await r.service.startWorkout({
      request_id: "new-start",
      workout_date_local: "2026-10-27",
      timezone: "Europe/Berlin",
      session_name: "Neue Einheit",
    })
  ).result!.workout!;
  expect(newWorkout.plan_version_id).toBe(cloned.plan_version_id);
  expect(
    (
      await r.service.startWorkout({
        request_id: "free",
        workout_date_local: "2026-10-27",
        timezone: "Europe/Berlin",
        session_name: "Spontan",
      })
    ).result!.workout!.plan_version_id,
  ).toBeNull();
  const analytics = buildArnoldDashboardAnalytics(after);
  expect(analytics.activity.completed_workouts.value).toBe(1);
  expect(analytics.volume.by_bucket.working.coverage?.eligible_sets).toBe(7);
  expect(analytics.volume.nominal_volume.status).toBe("partial");
  expect(after.sets.map((s) => s.load_kg)).toEqual([
    70,
    20,
    30,
    32,
    null,
    15,
    12,
  ]);
});

it("refuses two activations at the same clock instant rather than creating a false discarded-draft sentinel", async () => {
  let instant = Date.parse("2026-10-27T10:00:00Z");
  const r = createFixturePlanning(planFixtureDataset("empty"), {
    clock: () => new Date(instant),
  });
  const plan = async (id: string) =>
    (
      await r.plans.execute("create_training_plan", {
        request_id: id,
        name: id,
        sessions: [session(id)],
      })
    ).result!.plan!.version;
  const a = await plan("A"),
    b = await plan("B");
  const activate = (v: typeof a, id: string) =>
    r.plans.execute("activate_training_plan", {
      request_id: id,
      plan_version_id: v.plan_version_id,
      expected_row_revision: v.row_revision,
      confirmation: {
        plan_version_id: v.plan_version_id,
        row_revision: v.row_revision,
        confirmed: true,
      },
    });
  expect((await activate(a, "act-a")).ok).toBe(true);
  expect((await activate(b, "act-b")).error?.code).toBe("REVISION_CONFLICT");
  instant++;
  expect((await activate(b, "act-b")).ok).toBe(true);
  const old = (await r.repository.read()).plans.find(
    (p) => p.plan_version_id === a.plan_version_id,
  )!;
  expect(old.activated_at_utc).not.toBe(old.retired_at_utc);
  expect(
    (await r.plans.getPlan({ plan_version_id: a.plan_version_id })).plan
      .discarded,
  ).toBe(false);
});
