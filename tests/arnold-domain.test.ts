import { describe, expect, it } from "vitest";
import {
  ARNOLD_TABLE_HEADERS,
  ArnoldDatasetSchema,
  indexArnoldDataset,
} from "../src/shared/arnold-schema-v1";
import {
  ArnoldDataError,
  parseArnoldTables,
} from "../src/server/arnold-sheet-parser";
import {
  V1_HEADERS,
  v1Tables,
  templateTables,
  emptyHistory,
  setCell,
  setConfig,
  row,
  setBase,
  type FixtureTable,
} from "./fixtures/arnold-v1";

describe("Arnold v1 domain and exact sheet contract", () => {
  it("accepts a complete dataset, preserving IDs, raw fields, history and independent sessions", () => {
    const tables = v1Tables(),
      before = structuredClone(tables),
      data = parseArnoldTables(tables);
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
    expect(tables).toEqual(before);
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
  it("matches the independent contract headers and retains every table field", () => {
    expect(ARNOLD_TABLE_HEADERS).toEqual(V1_HEADERS);
    const data = parseArnoldTables(v1Tables());
    for (const [table, records] of [
      ["EXERCISES", data.exercises],
      ["PLANS", data.plans],
      ["PLAN_ITEMS", data.planItems],
      ["WORKOUTS", data.workouts],
      ["SETS", data.sets],
    ] as const)
      expect(Object.keys(records[0])).toEqual(V1_HEADERS[table]);
  });
  it("accepts empty workouts and sets, a user catalog without plans, and an empty master history", () => {
    const user = emptyHistory();
    user.PLANS.splice(1);
    user.PLAN_ITEMS.splice(1);
    expect(parseArnoldTables(user)).toMatchObject({
      plans: [],
      planItems: [],
      workouts: [],
      sets: [],
    });
    expect(parseArnoldTables(templateTables())).toMatchObject({
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
    const tables = v1Tables();
    tables.PLANS.splice(1);
    tables.PLAN_ITEMS.splice(1);
    tables.WORKOUTS.splice(1, 1);
    tables.SETS.splice(1, 1);
    const data = parseArnoldTables(tables);
    expect(data.plans).toEqual([]);
    expect(data.workouts).toHaveLength(1);
    expect(data.workouts[0].plan_version_id).toBeNull();
    expect(data.sets[0].workout_id).toBe(data.workouts[0].workout_id);
  });
  it("accepts workouts that do not have sets yet", () => {
    const tables = v1Tables();
    tables.SETS.splice(1);
    const data = parseArnoldTables(tables);
    expect(data.workouts).toHaveLength(2);
    expect(data.sets).toEqual([]);
    expect(
      indexArnoldDataset(data).setsByWorkoutId.get(data.workouts[0].workout_id),
    ).toEqual([]);
  });
  it("freezes returned records and arrays instead of exposing mutable historical snapshots", () => {
    const data = parseArnoldTables(v1Tables());
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
  it("links by opaque IDs when physical row order changes", () => {
    const tables = v1Tables();
    for (const table of [
      "EXERCISES",
      "PLANS",
      "PLAN_ITEMS",
      "WORKOUTS",
      "SETS",
    ] as const)
      tables[table].splice(
        1,
        tables[table].length - 1,
        ...tables[table].slice(1).reverse(),
      );
    const data = parseArnoldTables(tables),
      indexes = indexArnoldDataset(data);
    expect(indexes.workoutsById.get("test-workout-1")?.plan_version_id).toBe(
      "test-plan-v1",
    );
    expect(indexes.setsById.get("test-set-1")?.load_kg).toBe(20.123456789);
  });
  it.each(Object.keys(V1_HEADERS) as FixtureTable[])(
    "rejects a missing required header in %s",
    (table) => {
      const tables = v1Tables();
      tables[table][0].shift();
      expect(() => parseArnoldTables(tables)).toThrow(ArnoldDataError);
    },
  );
  it("rejects reordered/extra headers and data in undeclared columns", () => {
    for (const change of [
      (t: ReturnType<typeof v1Tables>) => {
        [t.SETS[0][1], t.SETS[0][2]] = [t.SETS[0][2], t.SETS[0][1]];
      },
      (t: ReturnType<typeof v1Tables>) => {
        t.SETS[0].push("derived_volume");
      },
      (t: ReturnType<typeof v1Tables>) => {
        t.SETS[1].push(123);
      },
    ]) {
      const t = v1Tables();
      change(t);
      expect(() => parseArnoldTables(t)).toThrow(ArnoldDataError);
    }
  });
  it.each([
    "schema_id",
    "schema_version",
    "schema_fingerprint",
    "raw_data_policy",
  ])("rejects incompatible CONFIG %s", (key) => {
    const t = v1Tables();
    setConfig(t, key, "unsupported");
    expect(() => parseArnoldTables(t)).toThrow(ArnoldDataError);
  });
  it("rejects duplicate/missing/unknown CONFIG keys and inconsistent template identity", () => {
    const duplicate = v1Tables();
    duplicate.CONFIG.push([...duplicate.CONFIG[1]]);
    expect(() => parseArnoldTables(duplicate)).toThrow("Doppelter CONFIG");
    const missing = v1Tables();
    missing.CONFIG.splice(1, 1);
    expect(() => parseArnoldTables(missing)).toThrow("schema_id");
    const extra = v1Tables();
    extra.CONFIG.push(["unrecognized_setting", "yes", ""]);
    expect(() => parseArnoldTables(extra)).toThrow(ArnoldDataError);
    const badUser = v1Tables();
    setConfig(badUser, "tracker_id", "TEMPLATE_UNASSIGNED");
    expect(() => parseArnoldTables(badUser)).toThrow("Tracker-IDs");
    const badMaster = v1Tables();
    setConfig(badMaster, "file_role", "MASTER_TEMPLATE");
    setConfig(badMaster, "tracker_id", "TEMPLATE_UNASSIGNED");
    expect(() => parseArnoldTables(badMaster)).toThrow("MASTER_TEMPLATE");
  });
  it.each(["EXERCISES", "PLANS", "PLAN_ITEMS", "WORKOUTS", "SETS"] as const)(
    "rejects duplicate IDs in %s",
    (table) => {
      const t = v1Tables();
      t[table].push([...t[table][1]]);
      expect(() => parseArnoldTables(t)).toThrow("Doppelte ID");
    },
  );
  it.each([
    ["SETS", "exercise_id"],
    ["SETS", "workout_id"],
    ["SETS", "plan_item_id"],
    ["PLAN_ITEMS", "exercise_id"],
    ["PLAN_ITEMS", "plan_version_id"],
    ["WORKOUTS", "plan_version_id"],
    ["WORKOUTS", "session_id"],
  ] as const)("rejects unknown %s.%s references", (table, column) => {
    const t = v1Tables();
    setCell(t, table, 0, column, "unknown-test-id");
    expect(() => parseArnoldTables(t)).toThrow(ArnoldDataError);
  });
  it("rejects cross-version/session/exercise plan-item associations and unscoped sessions", () => {
    for (const [table, record, column, value] of [
      ["SETS", 0, "plan_item_id", "test-item-v2"],
      ["SETS", 1, "plan_item_id", "test-item-v2"],
      ["SETS", 0, "exercise_id", "test-exercise-bar"],
      ["WORKOUTS", 0, "session_id", "test-session-v2"],
      ["WORKOUTS", 1, "session_id", "test-session-v1"],
    ] as const) {
      const t = v1Tables();
      setCell(t, table, record, column, value);
      expect(() => parseArnoldTables(t)).toThrow(ArnoldDataError);
    }
  });
  it("rejects multiple active plans, duplicate family versions and contradictory session labels", () => {
    const a = v1Tables();
    setCell(a, "PLANS", 0, "status", "active");
    setCell(a, "PLANS", 0, "retired_at_utc", null);
    expect(() => parseArnoldTables(a)).toThrow("aktive Planversion");
    const b = v1Tables();
    setCell(b, "PLANS", 2, "version_no", 2);
    expect(() => parseArnoldTables(b)).toThrow("Versionsnummer");
    const c = v1Tables();
    const copy = [...c.PLAN_ITEMS[1]];
    copy[0] = "different-test-item";
    copy[4] = "Contradicting session name";
    c.PLAN_ITEMS.push(copy);
    expect(() => parseArnoldTables(c)).toThrow("widersprüchlich");
  });
  it("supports unilateral left/right sets with equal set_number and explicit alternating repetitions", () => {
    const t = v1Tables();
    setCell(t, "SETS", 0, "execution_mode", "unilateral");
    setCell(t, "SETS", 0, "side", "left");
    t.SETS.push(
      row("SETS", {
        ...setBase,
        set_id: "test-set-right",
        execution_mode: "unilateral",
        side: "right",
        reps: 8,
        load_kg: 17.5,
      }),
    );
    t.SETS.push(
      row("SETS", {
        ...setBase,
        set_id: "test-set-alternating",
        set_number: 2,
        execution_mode: "alternating",
        side: "alternating",
        reps_basis: "per_side",
        reps: 7,
      }),
    );
    const d = parseArnoldTables(t);
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
    const t = v1Tables();
    setCell(t, "SETS", 0, "load_basis", basis);
    setCell(
      t,
      "SETS",
      0,
      "load_kg",
      basis === "bodyweight_only" ? null : 12.345678901,
    );
    expect(parseArnoldTables(t).sets[0]).toMatchObject({
      load_basis: basis,
      load_kg: basis === "bodyweight_only" ? null : 12.345678901,
    });
  });
  it("keeps absent values null and zero distinct, with no invented defaults", () => {
    const t = v1Tables();
    for (const col of ["rpe", "rir", "notes", "plan_item_id"]) {
      setCell(t, "SETS", 0, col, "");
    }
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
    ]) {
      setCell(t, "PLAN_ITEMS", 0, col, "");
    }
    setCell(t, "SETS", 0, "load_basis", "bodyweight_only");
    setCell(t, "SETS", 0, "load_kg", 0);
    const d = parseArnoldTables(t);
    expect(d.sets[0]).toMatchObject({
      rpe: null,
      rir: null,
      plan_item_id: null,
      load_kg: 0,
    });
    expect(d.planItems[0].target_load_kg).toBeNull();
    setCell(t, "SETS", 0, "implement_count", "");
    expect(() => parseArnoldTables(t)).toThrow(ArnoldDataError);
  });
  it.each([-1, NaN, Infinity, true, "20kg", "0x14", "1,5", " "])(
    "rejects invalid actual load %s",
    (value) => {
      const t = v1Tables();
      setCell(t, "SETS", 0, "load_kg", value);
      expect(() => parseArnoldTables(t)).toThrow(ArnoldDataError);
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
  ] as const)("rejects invalid SETS.%s=%s", (column, value) => {
    const t = v1Tables();
    setCell(t, "SETS", 0, column, value);
    expect(() => parseArnoldTables(t)).toThrow(ArnoldDataError);
  });
  it.each([
    ["EXERCISES", "status", "unknown"],
    ["PLANS", "status", "retired"],
    ["PLAN_ITEMS", "status", "archived"],
    ["WORKOUTS", "status", "active"],
    ["WORKOUTS", "workout_date_local", 46314],
    ["WORKOUTS", "workout_date_local", "2026-02-30"],
    ["WORKOUTS", "timezone", "not-a-zone"],
    ["EXERCISES", "created_at_utc", "2026-10-01T14:00:00+02:00"],
  ] as const)("rejects invalid %s.%s", (table, column, value) => {
    const t = v1Tables();
    setCell(t, table, 0, column, value);
    expect(() => parseArnoldTables(t)).toThrow(ArnoldDataError);
  });
  it("rejects duplicate active sets while preserving voided tombstones", () => {
    const t = v1Tables();
    t.SETS.push(row("SETS", { ...setBase, set_id: "test-duplicate" }));
    expect(() => parseArnoldTables(t)).toThrow("Doppelter aktiver Satz");
    setCell(t, "SETS", 2, "status", "voided");
    expect(parseArnoldTables(t).sets[2].status).toBe("voided");
  });
  it("validates ID whitespace, optional repetition ranges and time order", () => {
    const id = v1Tables();
    setCell(id, "EXERCISES", 0, "exercise_id", " test-exercise-db");
    expect(() => parseArnoldTables(id)).toThrow("Rand-Leerzeichen");
    const reps = v1Tables();
    setCell(reps, "PLAN_ITEMS", 0, "rep_max", 2);
    expect(() => parseArnoldTables(reps)).toThrow("rep_max");
    const time = v1Tables();
    setCell(time, "WORKOUTS", 0, "ended_at_utc", "2026-10-01T11:00:00Z");
    expect(() => parseArnoldTables(time)).toThrow("Workout-Ende");
  });
  it("reports the physical table, row and column without copying sensitive cell values", () => {
    const t = v1Tables();
    t.SETS.splice(1, 0, []);
    setCell(t, "SETS", 1, "reps", "SECRET_TEST_ONLY");
    try {
      parseArnoldTables(t);
      throw Error("Expected data error");
    } catch (error) {
      expect(error).toBeInstanceOf(ArnoldDataError);
      expect((error as ArnoldDataError).issues[0]).toMatchObject({
        table: "SETS",
        row: 3,
        column: "reps",
      });
      expect((error as Error).message).not.toContain("SECRET_TEST_ONLY");
    }
  });
  it("does not accept formula-derived cells or silently parse their evaluated metrics", () => {
    const t = v1Tables();
    setCell(t, "SETS", 0, "load_kg", { formulaValue: "=10*2" });
    expect(() => parseArnoldTables(t)).toThrow("Formeln");
  });
});
