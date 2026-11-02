import { describe, expect, it } from "vitest";
import {
  ArnoldDatasetSchema,
  indexArnoldDataset,
} from "../src/shared/arnold-schema-v1";
import {
  emptyHistory,
  parse,
  setBase,
  setConfig,
  setField,
  templateData,
  v1Data,
  type FixtureTable,
  type V1Data,
} from "./fixtures/arnold-v1";

const rejects = (data: V1Data) =>
  expect(ArnoldDatasetSchema.safeParse(data).success).toBe(false);

describe("Arnold v1 domain contract", () => {
  it("accepts a complete dataset, preserving IDs, raw fields, history and independent sessions", () => {
    const input = v1Data(),
      before = structuredClone(input),
      data = parse(input);
    expect(data.config.schema_id).toBe("arnold.training_raw");
    expect(data.workouts).toHaveLength(2);
    expect(data.workouts[0].workout_date_local).toBe("2026-10-02");
    expect(data.workouts[0].started_at_utc).toBe("2026-10-01T12:00:00Z");
    expect(data.sets[0]).toMatchObject({
      set_id: "test-set-1",
      exercise_id: "test-exercise-db",
      exercise_name_snapshot: "Historischer Testname",
      load_kg: 20.123456789,
      load_basis: "per_implement",
      implement_count: 2,
      reps: 10,
    });
    expect(data.sets[1]).toMatchObject({
      load_kg: 70,
      load_basis: "total",
      implement_count: 1,
      reps: 0,
      rir: 0,
    });
    expect(data.plans.map((p) => p.status)).toEqual([
      "archived",
      "active",
      "draft",
    ]);
    expect(data.exercises[0].status).toBe("retired");
    expect(data.workouts[1]).toMatchObject({
      plan_version_id: null,
      session_id: null,
    });
    expect(data.sets[0]).not.toHaveProperty("volume");
    expect(data.sets[0]).not.toHaveProperty("effective_load_kg");
    expect(input).toEqual(before);
    expect(ArnoldDatasetSchema.parse(data)).toEqual(data);
    const indexes = indexArnoldDataset(data);
    expect(indexes.exercisesById.get(data.sets[0].exercise_id)).toBe(
      data.exercises[0],
    );
    expect(
      indexes.plansByVersionId.get(data.workouts[0].plan_version_id!),
    ).toBe(data.plans[0]);
    expect(indexes.setsByWorkoutId.get(data.workouts[0].workout_id)).toEqual([
      data.sets[0],
    ]);
  });
  it("accepts empty workouts and sets, a user catalog without plans, and an empty master history", () => {
    const user = emptyHistory();
    user.plans = [];
    user.planItems = [];
    expect(parse(user)).toMatchObject({
      plans: [],
      planItems: [],
      workouts: [],
      sets: [],
    });
    expect(parse(templateData())).toMatchObject({
      config: {
        file_role: "MASTER_TEMPLATE",
        tracker_id: "TEMPLATE_UNASSIGNED",
      },
      plans: [],
      workouts: [],
      sets: [],
    });
  });
  it("accepts a standalone workout when no plan exists at all", () => {
    const input = v1Data();
    input.plans = [];
    input.planItems = [];
    input.workouts = [input.workouts[1]];
    input.sets = [input.sets[1]];
    const data = parse(input);
    expect(data.plans).toEqual([]);
    expect(data.workouts).toHaveLength(1);
    expect(data.workouts[0].plan_version_id).toBeNull();
    expect(data.sets[0].workout_id).toBe(data.workouts[0].workout_id);
  });
  it("accepts workouts that do not have sets yet", () => {
    const input = v1Data();
    input.sets = [];
    const data = parse(input);
    expect(data.workouts).toHaveLength(2);
    expect(data.sets).toEqual([]);
    expect(
      indexArnoldDataset(data).setsByWorkoutId.get(data.workouts[0].workout_id),
    ).toEqual([]);
  });
  it("freezes returned records and arrays instead of exposing mutable historical snapshots", () => {
    const data = parse(v1Data());
    for (const object of [
      data,
      data.config,
      data.configEntries,
      data.configEntries[0],
      data.sets,
      data.sets[0],
      data.plans[0],
    ])
      expect(Object.isFrozen(object)).toBe(true);
    expect(() => Object.assign(data.sets[0], { load_kg: 999 })).toThrow();
  });
  it("links by opaque IDs, whatever the order of rows", () => {
    const input = v1Data();
    for (const table of [
      "exercises",
      "plans",
      "planItems",
      "workouts",
      "sets",
    ] as const)
      input[table].reverse();
    const indexes = indexArnoldDataset(parse(input));
    expect(indexes.workoutsById.get("test-workout-1")?.plan_version_id).toBe(
      "test-plan-v1",
    );
    expect(indexes.setsById.get("test-set-1")?.load_kg).toBe(20.123456789);
  });
  it("rejects unknown fields on a row", () => {
    const input = v1Data();
    input.sets[0].derived_volume = 200;
    rejects(input);
  });
  it.each([
    "schema_id",
    "schema_version",
    "schema_fingerprint",
    "raw_data_policy",
  ])("rejects incompatible CONFIG %s", (key) => {
    const input = v1Data();
    setConfig(input, key, "unsupported");
    rejects(input);
  });
  it("rejects duplicate/missing/unknown CONFIG keys and inconsistent template identity", () => {
    const duplicate = v1Data();
    duplicate.configEntries.push({ ...duplicate.configEntries[0] });
    expect(() => parse(duplicate)).toThrow("Doppelter CONFIG");
    const missing = v1Data();
    missing.configEntries.splice(0, 1);
    expect(() => parse(missing)).toThrow("schema_id");
    const extra = v1Data();
    extra.configEntries.push({
      key: "unrecognized_setting",
      value: "yes",
      description: null,
    });
    rejects(extra);
    const badUser = v1Data();
    setConfig(badUser, "tracker_id", "TEMPLATE_UNASSIGNED");
    expect(() => parse(badUser)).toThrow("Tracker-IDs");
    const badMaster = v1Data();
    setConfig(badMaster, "file_role", "MASTER_TEMPLATE");
    setConfig(badMaster, "tracker_id", "TEMPLATE_UNASSIGNED");
    expect(() => parse(badMaster)).toThrow("MASTER_TEMPLATE");
  });
  it.each(["exercises", "plans", "planItems", "workouts", "sets"] as const)(
    "rejects duplicate IDs in %s",
    (table) => {
      const input = v1Data();
      input[table].push({ ...input[table][0] });
      expect(() => parse(input)).toThrow("Doppelte ID");
    },
  );
  it.each([
    ["sets", "exercise_id"],
    ["sets", "workout_id"],
    ["sets", "plan_item_id"],
    ["planItems", "exercise_id"],
    ["planItems", "plan_version_id"],
    ["workouts", "plan_version_id"],
    ["workouts", "session_id"],
  ] as const)("rejects unknown %s.%s references", (table, column) => {
    const input = v1Data();
    setField(input, table, 0, column, "unknown-test-id");
    rejects(input);
  });
  it("rejects cross-version/session/exercise plan-item associations and unscoped sessions", () => {
    for (const [table, index, column, value] of [
      ["sets", 0, "plan_item_id", "test-item-v2"],
      ["sets", 1, "plan_item_id", "test-item-v2"],
      ["sets", 0, "exercise_id", "test-exercise-bar"],
      ["workouts", 0, "session_id", "test-session-v2"],
      ["workouts", 1, "session_id", "test-session-v1"],
    ] as const) {
      const input = v1Data();
      setField(input, table, index, column, value);
      rejects(input);
    }
  });
  it("rejects multiple active plans, duplicate family versions and contradictory session labels", () => {
    const a = v1Data();
    setField(a, "plans", 0, "status", "active");
    setField(a, "plans", 0, "retired_at_utc", null);
    expect(() => parse(a)).toThrow("aktive Planversion");
    const b = v1Data();
    setField(b, "plans", 2, "version_no", 2);
    expect(() => parse(b)).toThrow("Versionsnummer");
    const c = v1Data();
    c.planItems.push({
      ...c.planItems[0],
      plan_item_id: "different-test-item",
      session_name: "Contradicting session name",
    });
    expect(() => parse(c)).toThrow("widersprüchlich");
  });
  it("supports unilateral left/right sets with equal set_number and explicit alternating repetitions", () => {
    const input = v1Data();
    setField(input, "sets", 0, "execution_mode", "unilateral");
    setField(input, "sets", 0, "side", "left");
    input.sets.push(
      {
        ...setBase,
        set_id: "test-set-right",
        execution_mode: "unilateral",
        side: "right",
        reps: 8,
        load_kg: 17.5,
      },
      {
        ...setBase,
        set_id: "test-set-alternating",
        set_number: 2,
        execution_mode: "alternating",
        side: "alternating",
        reps_basis: "per_side",
        reps: 7,
      },
    );
    const d = parse(input);
    expect(d.sets[0].side).toBe("left");
    expect(d.sets[2]).toMatchObject({
      side: "right",
      set_number: 1,
      reps: 8,
      load_kg: 17.5,
    });
    expect(d.sets[3].reps_basis).toBe("per_side");
  });
  it.each([
    "total",
    "per_implement",
    "machine_display",
    "added",
    "assistance",
    "bodyweight_only",
  ])("preserves %s load basis without converting or rounding", (basis) => {
    const input = v1Data();
    setField(input, "sets", 0, "load_basis", basis);
    setField(
      input,
      "sets",
      0,
      "load_kg",
      basis === "bodyweight_only" ? null : 12.345678901,
    );
    expect(parse(input).sets[0]).toMatchObject({
      load_basis: basis,
      load_kg: basis === "bodyweight_only" ? null : 12.345678901,
    });
  });
  it("keeps absent values null and zero distinct, with no invented defaults", () => {
    const input = v1Data();
    for (const col of ["rpe", "rir", "notes", "plan_item_id"])
      setField(input, "sets", 0, col, null);
    for (const col of [
      "target_sets",
      "rep_min",
      "rep_max",
      "target_load_kg",
      "target_load_basis",
      "target_execution_mode",
      "target_implement_count",
      "rest_seconds",
      "notes",
    ])
      setField(input, "planItems", 0, col, null);
    setField(input, "sets", 0, "load_basis", "bodyweight_only");
    setField(input, "sets", 0, "load_kg", 0);
    const d = parse(input);
    expect(d.sets[0]).toMatchObject({
      rpe: null,
      rir: null,
      plan_item_id: null,
      load_kg: 0,
    });
    expect(d.planItems[0].target_load_kg).toBeNull();
    setField(input, "sets", 0, "implement_count", null);
    rejects(input);
  });
  it.each([-1, NaN, Infinity, true, "20kg", "0x14", "1,5", " ", "20"])(
    "rejects invalid actual load %s",
    (value) => {
      const input = v1Data();
      setField(input, "sets", 0, "load_kg", value);
      rejects(input);
    },
  );
  it.each([
    ["reps", 1.5],
    ["set_number", 0],
    ["row_revision", 0],
    ["rpe", 11],
    ["rir", -1],
    ["status", "deleted"],
    ["source", "llm"],
    ["load_basis", "effective"],
    ["execution_mode", "single"],
    ["side", "left"],
  ] as const)("rejects invalid sets.%s=%s", (column, value) => {
    const input = v1Data();
    setField(input, "sets", 0, column, value);
    rejects(input);
  });
  it.each([
    ["exercises", "status", "unknown"],
    ["plans", "status", "retired"],
    ["planItems", "status", "archived"],
    ["workouts", "status", "active"],
    ["workouts", "workout_date_local", 46314],
    ["workouts", "workout_date_local", "2026-02-30"],
    ["workouts", "timezone", "not-a-zone"],
    ["exercises", "created_at_utc", "2026-10-01T14:00:00+02:00"],
  ] as const)("rejects invalid %s.%s", (table: FixtureTable, column, value) => {
    const input = v1Data();
    setField(input, table, 0, column, value);
    rejects(input);
  });
  it("rejects duplicate active sets while preserving voided tombstones", () => {
    const input = v1Data();
    input.sets.push({ ...setBase, set_id: "test-duplicate" });
    expect(() => parse(input)).toThrow("Doppelter aktiver Satz");
    setField(input, "sets", 2, "status", "voided");
    expect(parse(input).sets[2].status).toBe("voided");
  });
  it("validates ID whitespace, optional repetition ranges and time order", () => {
    const id = v1Data();
    setField(id, "exercises", 0, "exercise_id", " test-exercise-db");
    expect(() => parse(id)).toThrow("Rand-Leerzeichen");
    const reps = v1Data();
    setField(reps, "planItems", 0, "rep_max", 2);
    expect(() => parse(reps)).toThrow("rep_max");
    const time = v1Data();
    setField(time, "workouts", 0, "ended_at_utc", "2026-10-01T11:00:00Z");
    expect(() => parse(time)).toThrow("Workout-Ende");
  });
});
