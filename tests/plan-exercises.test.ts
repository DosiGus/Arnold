import { describe, expect, it } from "vitest";
import {
  draft,
  exerciseNames,
  harness,
  itemOf,
  rawItems,
  session,
  sessionOf,
  type Harness,
} from "./fixtures/arnold-plan";

async function edit(
  h: Harness,
  version: { plan_version_id: string; row_revision: number },
  ...edits: unknown[]
) {
  const result = await h.ok("update_plan_draft", {
    request_id: `e-${Math.random().toString(36).slice(2)}`,
    plan_version_id: version.plan_version_id,
    expected_row_revision: version.row_revision,
    edits,
  });
  return result.plan!.version;
}

const refuse = async (
  h: Harness,
  version: { plan_version_id: string; row_revision: number },
  ...edits: unknown[]
) =>
  h.fails("update_plan_draft", {
    request_id: `x-${Math.random().toString(36).slice(2)}`,
    plan_version_id: version.plan_version_id,
    expected_row_revision: version.row_revision,
    edits,
  });

describe("editing exercises inside a plan", () => {
  it("adds an exercise to a named session", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("Push", ["plan-fx-bench"])]);
    version = await edit(h, version, {
      type: "add_plan_exercise",
      session_id: sessionOf(version, "Push").session_id,
      exercise_id: "plan-fx-lateral",
      target_sets: 3,
      rep_min: 12,
      rep_max: 15,
    });
    expect(exerciseNames(version, "Push")).toEqual([
      "plan-fx-bench",
      "plan-fx-lateral",
    ]);
    const added = itemOf(version, "plan-fx-lateral", "Push");
    expect(added.exercise_order).toBe(2);
    // Catalog defaults for execution are adopted.
    expect(added.target_load_basis).toBe("per_implement");
    expect(added.target_implement_count).toBe(2);
    expect(added.exercise_name).toBe("Demo Seitheben");
  });

  it("adds an exercise at an explicit position", async () => {
    const h = harness("empty");
    let version = await draft(h, [
      session("Push", ["plan-fx-bench", "plan-fx-lateral"]),
    ]);
    version = await edit(h, version, {
      type: "add_plan_exercise",
      session_id: sessionOf(version, "Push").session_id,
      exercise_id: "plan-fx-incline",
      exercise_order: 2,
    });
    expect(exerciseNames(version, "Push")).toEqual([
      "plan-fx-bench",
      "plan-fx-incline",
      "plan-fx-lateral",
    ]);
    expect(
      sessionOf(version, "Push").exercises.map((e) => e.exercise_order),
    ).toEqual([1, 2, 3]);
  });

  it("refuses an unknown exercise", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("Push")]);
    const error = await refuse(h, version, {
      type: "add_plan_exercise",
      session_id: sessionOf(version, "Push").session_id,
      exercise_id: "ghost",
    });
    expect(error.code).toBe("EXERCISE_NOT_FOUND");
  });

  it("replaces an exercise with a new position ID and tombstones the old one", async () => {
    const h = harness("empty");
    let version = await draft(h, [
      session("Push", ["plan-fx-bench", "plan-fx-lateral"]),
    ]);
    const old = itemOf(version, "plan-fx-bench", "Push");
    version = await edit(h, version, {
      type: "replace_plan_exercise",
      plan_item_id: old.plan_item_id,
      new_exercise_id: "plan-fx-db-bench",
    });

    expect(exerciseNames(version, "Push")).toEqual([
      "plan-fx-db-bench",
      "plan-fx-lateral",
    ]);
    const next = itemOf(version, "plan-fx-db-bench", "Push");
    expect(next.plan_item_id).not.toBe(old.plan_item_id);
    // It takes over the position the replaced exercise held.
    expect(next.exercise_order).toBe(1);
    // The replaced row survives as a tombstone; the name was not overwritten.
    const rows = rawItems(await h.dataset(), version.plan_version_id);
    const tombstone = rows.find((r) => r.plan_item_id === old.plan_item_id)!;
    expect(tombstone.status).toBe("removed");
    expect(tombstone.exercise_id).toBe("plan-fx-bench");
  });

  it("takes the new movement's load convention rather than carrying the old target over", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("Push", ["plan-fx-bench"])]);
    const old = itemOf(version, "plan-fx-bench", "Push");
    expect(old.target_load_basis).toBe("total");
    version = await edit(h, version, {
      type: "replace_plan_exercise",
      plan_item_id: old.plan_item_id,
      new_exercise_id: "plan-fx-db-bench",
    });
    const next = itemOf(version, "plan-fx-db-bench", "Push");
    // 70 kg total is not 70 kg per dumbbell, so the weight is not inherited.
    expect(next.target_load_basis).toBe("per_implement");
    expect(next.target_load_kg).toBeNull();
    // Sets and reps are movement-independent and do carry over.
    expect([next.target_sets, next.rep_min, next.rep_max]).toEqual([3, 8, 12]);
  });

  it("treats replacing an exercise with itself as a retargeting", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("Push", ["plan-fx-bench"])]);
    const old = itemOf(version, "plan-fx-bench", "Push");
    version = await edit(h, version, {
      type: "replace_plan_exercise",
      plan_item_id: old.plan_item_id,
      new_exercise_id: "plan-fx-bench",
      target_sets: 5,
    });
    const next = itemOf(version, "plan-fx-bench", "Push");
    expect(next.plan_item_id).toBe(old.plan_item_id);
    expect(next.target_sets).toBe(5);
    expect(next.row_revision).toBe(old.row_revision + 1);
  });

  it("removes an exercise and renumbers the rest", async () => {
    const h = harness("empty");
    let version = await draft(h, [
      session("Push", ["plan-fx-bench", "plan-fx-incline", "plan-fx-lateral"]),
    ]);
    const middle = itemOf(version, "plan-fx-incline", "Push");
    version = await edit(h, version, {
      type: "remove_plan_exercise",
      plan_item_id: middle.plan_item_id,
    });
    expect(exerciseNames(version, "Push")).toEqual([
      "plan-fx-bench",
      "plan-fx-lateral",
    ]);
    expect(
      sessionOf(version, "Push").exercises.map((e) => e.exercise_order),
    ).toEqual([1, 2]);
    expect(sessionOf(version, "Push").removed_exercise_count).toBe(1);
    // The catalog entry itself is untouched.
    expect(
      (await h.dataset()).exercises.find(
        (e) => e.exercise_id === "plan-fx-incline",
      )!.status,
    ).toBe("active");
  });

  it("moves an exercise to the end deterministically", async () => {
    const h = harness("empty");
    let version = await draft(h, [
      session("Push", ["plan-fx-bench", "plan-fx-lateral", "plan-fx-incline"]),
    ]);
    const s = sessionOf(version, "Push");
    const byId = Object.fromEntries(
      s.exercises.map((e) => [e.exercise_id, e.plan_item_id]),
    );
    version = await edit(h, version, {
      type: "reorder_plan_exercises",
      session_id: s.session_id,
      plan_item_ids: [
        byId["plan-fx-bench"],
        byId["plan-fx-incline"],
        byId["plan-fx-lateral"],
      ],
    });
    expect(exerciseNames(version, "Push")).toEqual([
      "plan-fx-bench",
      "plan-fx-incline",
      "plan-fx-lateral",
    ]);
    expect(
      sessionOf(version, "Push").exercises.map((e) => e.exercise_order),
    ).toEqual([1, 2, 3]);
  });

  it("rejects an incomplete reordering", async () => {
    const h = harness("empty");
    const version = await draft(h, [
      session("Push", ["plan-fx-bench", "plan-fx-lateral"]),
    ]);
    const s = sessionOf(version, "Push");
    const error = await refuse(h, version, {
      type: "reorder_plan_exercises",
      session_id: s.session_id,
      plan_item_ids: [s.exercises[0].plan_item_id],
    });
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("changes three sets to four", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("Pull", ["plan-fx-pullup"])]);
    const item = itemOf(version, "plan-fx-pullup", "Pull");
    expect(item.target_sets).toBe(3);
    version = await edit(h, version, {
      type: "update_plan_exercise_targets",
      plan_item_id: item.plan_item_id,
      targets: { target_sets: 4 },
    });
    const updated = itemOf(version, "plan-fx-pullup", "Pull");
    expect(updated.target_sets).toBe(4);
    // Identity and everything else are preserved.
    expect(updated.plan_item_id).toBe(item.plan_item_id);
    expect([updated.rep_min, updated.rep_max]).toEqual([
      item.rep_min,
      item.rep_max,
    ]);
  });

  it("changes the rep range, target weight and rest", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("Push", ["plan-fx-bench"])]);
    const item = itemOf(version, "plan-fx-bench", "Push");
    version = await edit(h, version, {
      type: "update_plan_exercise_targets",
      plan_item_id: item.plan_item_id,
      targets: {
        rep_min: 5,
        rep_max: 7,
        target_load_kg: 80,
        rest_seconds: 180,
        notes: "Pause lang",
      },
    });
    const updated = itemOf(version, "plan-fx-bench", "Push");
    expect([
      updated.rep_min,
      updated.rep_max,
      updated.target_load_kg,
      updated.rest_seconds,
    ]).toEqual([5, 7, 80, 180]);
    expect(updated.notes).toBe("Pause lang");
  });

  it("refuses an inverted rep range", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("Push", ["plan-fx-bench"])]);
    const item = itemOf(version, "plan-fx-bench", "Push");
    const error = await refuse(h, version, {
      type: "update_plan_exercise_targets",
      plan_item_id: item.plan_item_id,
      targets: { rep_min: 12, rep_max: 8 },
    });
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details.join(" ")).toMatch(/INVALID_REP_RANGE/);
  });

  it("refuses a negative target weight", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("Push", ["plan-fx-bench"])]);
    const item = itemOf(version, "plan-fx-bench", "Push");
    const error = await refuse(h, version, {
      type: "update_plan_exercise_targets",
      plan_item_id: item.plan_item_id,
      targets: { target_load_kg: -20 },
    });
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses a target weight without its load convention", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("Pull", ["plan-fx-pullup"])]);
    const item = itemOf(version, "plan-fx-pullup", "Pull");
    const error = await refuse(h, version, {
      type: "update_plan_exercise_targets",
      plan_item_id: item.plan_item_id,
      targets: { target_load_kg: 10, target_load_basis: null },
    });
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details.join(" ")).toMatch(/LOAD_BASIS_MISMATCH/);
  });

  it("refuses a target weight on a bodyweight-only convention", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("Pull", ["plan-fx-pullup"])]);
    const item = itemOf(version, "plan-fx-pullup", "Pull");
    const error = await refuse(h, version, {
      type: "update_plan_exercise_targets",
      plan_item_id: item.plan_item_id,
      targets: { target_load_kg: 10 },
    });
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details.join(" ")).toMatch(/INVALID_TARGET_LOAD/);
  });

  it("allows added weight on a bodyweight exercise with the right convention", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("Pull", ["plan-fx-pullup"])]);
    const item = itemOf(version, "plan-fx-pullup", "Pull");
    version = await edit(h, version, {
      type: "update_plan_exercise_targets",
      plan_item_id: item.plan_item_id,
      targets: { target_load_basis: "added", target_load_kg: 10 },
    });
    const updated = itemOf(version, "plan-fx-pullup", "Pull");
    expect(updated.target_load_basis).toBe("added");
    expect(updated.target_load_kg).toBe(10);
  });

  it("changes the execution mode and implement count together", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("Push", ["plan-fx-db-bench"])]);
    const item = itemOf(version, "plan-fx-db-bench", "Push");
    expect(item.target_execution_mode).toBe("bilateral_simultaneous");
    version = await edit(h, version, {
      type: "update_plan_exercise_execution",
      plan_item_id: item.plan_item_id,
      target_execution_mode: "unilateral",
      target_implement_count: 1,
    });
    const updated = itemOf(version, "plan-fx-db-bench", "Push");
    expect(updated.target_execution_mode).toBe("unilateral");
    expect(updated.target_implement_count).toBe(1);
  });

  it("refuses a unilateral execution with two implements", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("Push", ["plan-fx-db-bench"])]);
    const item = itemOf(version, "plan-fx-db-bench", "Push");
    const error = await refuse(h, version, {
      type: "update_plan_exercise_execution",
      plan_item_id: item.plan_item_id,
      target_execution_mode: "unilateral",
      target_implement_count: 2,
    });
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details.join(" ")).toMatch(/INVALID_EXECUTION/);
  });

  it("refuses editing a position that is already removed", async () => {
    const h = harness("empty");
    let version = await draft(h, [
      session("Push", ["plan-fx-bench", "plan-fx-lateral"]),
    ]);
    const item = itemOf(version, "plan-fx-lateral", "Push");
    version = await edit(h, version, {
      type: "remove_plan_exercise",
      plan_item_id: item.plan_item_id,
    });
    const error = await refuse(h, version, {
      type: "update_plan_exercise_targets",
      plan_item_id: item.plan_item_id,
      targets: { target_sets: 9 },
    });
    expect(error.code).toBe("PLAN_ITEM_NOT_FOUND");
  });

  it("keeps a session alive when its last exercise is replaced", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("Push", ["plan-fx-bench"])]);
    const item = itemOf(version, "plan-fx-bench", "Push");
    version = await edit(h, version, {
      type: "replace_plan_exercise",
      plan_item_id: item.plan_item_id,
      new_exercise_id: "plan-fx-db-bench",
    });
    expect(version.session_count).toBe(1);
    expect(exerciseNames(version, "Push")).toEqual(["plan-fx-db-bench"]);
    expect(sessionOf(version, "Push").session_order).toBe(1);
  });

  it("applies add, reorder and retarget in one revision", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("Push", ["plan-fx-bench"])]);
    const start = version.row_revision;
    const s = sessionOf(version, "Push");
    const bench = itemOf(version, "plan-fx-bench", "Push");
    const result = await h.ok("update_plan_draft", {
      request_id: "combo",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [
        {
          type: "add_plan_exercise",
          session_id: s.session_id,
          exercise_id: "plan-fx-lateral",
        },
        {
          type: "update_plan_exercise_targets",
          plan_item_id: bench.plan_item_id,
          targets: { target_sets: 5 },
        },
      ],
    });
    version = result.plan!.version;
    expect(version.row_revision).toBe(start + 1);
    expect(exerciseNames(version, "Push")).toEqual([
      "plan-fx-bench",
      "plan-fx-lateral",
    ]);
    expect(itemOf(version, "plan-fx-bench", "Push").target_sets).toBe(5);
    // The bench row moved exactly one revision, not two.
    expect(itemOf(version, "plan-fx-bench", "Push").row_revision).toBe(
      bench.row_revision + 1,
    );
  });

  it("writes nothing but the revision bump for an edit that changes nothing", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("Push", ["plan-fx-bench"])]);
    const before = rawItems(await h.dataset(), version.plan_version_id);
    const result = await h.ok("update_plan_draft", {
      request_id: "noop",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [{ type: "update_plan_metadata", name: version.name }],
    });
    const after = rawItems(await h.dataset(), version.plan_version_id);
    expect(after.map((r) => r.row_revision)).toEqual(
      before.map((r) => r.row_revision),
    );
    expect(result.plan!.version.row_revision).toBe(version.row_revision + 1);
  });

  it("flags a retired catalog entry as a warning, not an error", async () => {
    const h = harness("empty");
    const result = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Mit ausgemusterter Übung",
      sessions: [session("Push", ["plan-fx-retired"])],
    });
    expect(result.validation!.valid).toBe(true);
    expect(result.validation!.warnings.map((w) => w.code)).toContain(
      "RETIRED_EXERCISE",
    );
  });
});
