import { describe, expect, it } from "vitest";
import {
  draft,
  exerciseNames,
  harness,
  names,
  rawItems,
  session,
  sessionOf,
  type Harness,
} from "./fixtures/arnold-plan";

/** Edits a draft and returns the resulting version. */
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

describe("editing training sessions", () => {
  it("adds a fourth training day", async () => {
    const h = harness("empty");
    let version = await draft(h, [
      session("Push"),
      session("Pull"),
      session("Legs"),
    ]);
    version = await edit(h, version, {
      type: "add_session",
      session_name: "Arme",
      exercises: [
        {
          exercise_id: "plan-fx-curl",
          target_sets: 3,
          rep_min: 10,
          rep_max: 12,
        },
      ],
    });
    expect(names(version)).toEqual(["Push", "Pull", "Legs", "Arme"]);
    expect(sessionOf(version, "Arme").session_order).toBe(4);
    expect(sessionOf(version, "Arme").persisted).toBe(true);
  });

  it("gives a new session a new session ID", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("A")]);
    const before = version.sessions.map((s) => s.session_id);
    version = await edit(h, version, {
      type: "add_session",
      session_name: "B",
      exercises: [{ exercise_id: "plan-fx-squat" }],
    });
    const added = sessionOf(version, "B");
    expect(before).not.toContain(added.session_id);
  });

  it("inserts a session at an explicit position", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("A"), session("C")]);
    version = await edit(h, version, {
      type: "add_session",
      session_name: "B",
      session_order: 2,
      exercises: [{ exercise_id: "plan-fx-squat" }],
    });
    expect(names(version)).toEqual(["A", "B", "C"]);
    expect(version.sessions.map((s) => s.session_order)).toEqual([1, 2, 3]);
  });

  it("renames a session consistently across all its positions", async () => {
    const h = harness("empty");
    let version = await draft(h, [
      session("Push A", ["plan-fx-bench", "plan-fx-lateral"]),
    ]);
    const sessionId = version.sessions[0].session_id;
    version = await edit(h, version, {
      type: "rename_session",
      session_id: sessionId,
      session_name: "Oberkörper A",
    });
    expect(names(version)).toEqual(["Oberkörper A"]);
    // Every row of the session carries the new name; none keeps the old one.
    const rows = rawItems(await h.dataset(), version.plan_version_id);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.session_name))).toEqual(
      new Set(["Oberkörper A"]),
    );
    // The session identity itself does not change.
    expect(version.sessions[0].session_id).toBe(sessionId);
  });

  it("refuses a rename that collides with another session", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("Push"), session("Pull")]);
    const error = await h.fails("update_plan_draft", {
      request_id: "r1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [
        {
          type: "rename_session",
          session_id: sessionOf(version, "Pull").session_id,
          session_name: "Push",
        },
      ],
    });
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("reorders sessions with unambiguous order values", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("A"), session("B"), session("C")]);
    const ids = Object.fromEntries(
      version.sessions.map((s) => [s.session_name, s.session_id]),
    );
    version = await edit(h, version, {
      type: "reorder_sessions",
      session_ids: [ids.C, ids.A, ids.B],
    });
    expect(names(version)).toEqual(["C", "A", "B"]);
    expect(version.sessions.map((s) => s.session_order)).toEqual([1, 2, 3]);
    // Order values stay unique across the raw rows too.
    const rows = rawItems(await h.dataset(), version.plan_version_id);
    const perSession = new Map(
      rows.map((r) => [r.session_id, r.session_order]),
    );
    expect(new Set(perSession.values()).size).toBe(3);
  });

  it("rejects a partial or duplicated reordering", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("A"), session("B"), session("C")]);
    const ids = version.sessions.map((s) => s.session_id);
    for (const session_ids of [
      [ids[0]],
      [ids[0], ids[0], ids[1]],
      [...ids, "ghost"],
    ]) {
      const error = await h.fails("update_plan_draft", {
        request_id: `r-${session_ids.join("-")}`,
        plan_version_id: version.plan_version_id,
        expected_row_revision: version.row_revision,
        edits: [{ type: "reorder_sessions", session_ids }],
      });
      expect(error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("duplicates a session with new IDs and leaves the original untouched", async () => {
    const h = harness("empty");
    let version = await draft(h, [
      session("Push", ["plan-fx-bench", "plan-fx-lateral"], {
        target_sets: 4,
        rep_min: 6,
        rep_max: 8,
      }),
    ]);
    const original = sessionOf(version, "Push");
    version = await edit(h, version, {
      type: "duplicate_session",
      session_id: original.session_id,
      session_name: "Push B",
    });
    const copy = sessionOf(version, "Push B");
    expect(names(version)).toEqual(["Push", "Push B"]);
    expect(copy.session_id).not.toBe(original.session_id);
    // New position IDs, same catalog references, same targets.
    const originalIds = original.exercises.map((e) => e.plan_item_id);
    for (const exercise of copy.exercises)
      expect(originalIds).not.toContain(exercise.plan_item_id);
    expect(copy.exercises.map((e) => e.exercise_id)).toEqual(
      original.exercises.map((e) => e.exercise_id),
    );
    expect(copy.exercises.map((e) => e.target_sets)).toEqual([4, 4]);
    // The original is unchanged.
    const after = sessionOf(version, "Push");
    expect(after.exercises.map((e) => e.plan_item_id)).toEqual(originalIds);
  });

  it("places a duplicate directly after its original", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("A"), session("B")]);
    version = await edit(h, version, {
      type: "duplicate_session",
      session_id: sessionOf(version, "A").session_id,
    });
    expect(names(version)).toEqual(["A", "A (Kopie)", "B"]);
  });

  it("finds a free name when duplicating twice", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("A")]);
    const id = sessionOf(version, "A").session_id;
    version = await edit(h, version, {
      type: "duplicate_session",
      session_id: id,
    });
    version = await edit(h, version, {
      type: "duplicate_session",
      session_id: id,
    });
    // Each copy is inserted directly after the session it was copied from, so
    // the newer copy of "A" sits closest to it.
    expect(names(version)).toEqual(["A", "A (Kopie 2)", "A (Kopie)"]);
    expect(new Set(names(version)).size).toBe(3);
  });

  it("removes a session without deleting any row", async () => {
    const h = harness("empty");
    let version = await draft(h, [
      session("A"),
      session("B", ["plan-fx-squat"]),
    ]);
    const removedId = sessionOf(version, "B").session_id;
    const countBefore = rawItems(
      await h.dataset(),
      version.plan_version_id,
    ).length;
    version = await edit(h, version, {
      type: "remove_session",
      session_id: removedId,
    });

    expect(names(version)).toEqual(["A"]);
    expect(version.session_count).toBe(1);
    // Nothing was deleted: the row survives as a tombstone.
    const rows = rawItems(await h.dataset(), version.plan_version_id);
    expect(rows).toHaveLength(countBefore);
    const tombstones = rows.filter((r) => r.session_id === removedId);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].status).toBe("removed");
  });

  it("renumbers remaining sessions after a removal", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("A"), session("B"), session("C")]);
    version = await edit(h, version, {
      type: "remove_session",
      session_id: sessionOf(version, "B").session_id,
    });
    expect(names(version)).toEqual(["A", "C"]);
    expect(version.sessions.map((s) => s.session_order)).toEqual([1, 2]);
  });

  it("rejects editing a session that is not in the draft", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("A")]);
    const error = await h.fails("update_plan_draft", {
      request_id: "r1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [
        { type: "rename_session", session_id: "ghost", session_name: "X" },
      ],
    });
    expect(error.code).toBe("SESSION_NOT_FOUND");
  });

  it("applies several session edits as one revision", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("A"), session("B")]);
    const startRevision = version.row_revision;
    const ids = Object.fromEntries(
      version.sessions.map((s) => [s.session_name, s.session_id]),
    );
    version = await edit(
      h,
      version,
      {
        type: "add_session",
        session_name: "C",
        exercises: [{ exercise_id: "plan-fx-squat" }],
      },
      { type: "rename_session", session_id: ids.A, session_name: "A neu" },
      { type: "remove_session", session_id: ids.B },
    );
    expect(names(version)).toEqual(["A neu", "C"]);
    // One batch, one revision step.
    expect(version.row_revision).toBe(startRevision + 1);
  });

  it("supports a wholesale redesign of the whole routine", async () => {
    const h = harness("empty");
    let version = await draft(h, [
      session("Push"),
      session("Pull"),
      session("Legs"),
    ]);
    version = await edit(h, version, {
      type: "replace_draft_sessions",
      sessions: [
        session("Oberkörper", ["plan-fx-bench", "plan-fx-row"]),
        session("Unterkörper", ["plan-fx-squat", "plan-fx-legcurl"]),
      ],
    });
    expect(names(version)).toEqual(["Oberkörper", "Unterkörper"]);
    expect(exerciseNames(version, "Oberkörper")).toEqual([
      "plan-fx-bench",
      "plan-fx-row",
    ]);
    // Previous positions survive as tombstones; nothing was deleted.
    const rows = rawItems(await h.dataset(), version.plan_version_id);
    expect(rows.filter((r) => r.status === "removed")).toHaveLength(3);
    expect(rows.filter((r) => r.status === "active")).toHaveLength(4);
  });

  it("allows a redesign to reuse a session name on a new identity", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("Push", ["plan-fx-bench"])]);
    const oldId = sessionOf(version, "Push").session_id;
    version = await edit(h, version, {
      type: "replace_draft_sessions",
      sessions: [session("Push", ["plan-fx-squat"])],
    });
    expect(names(version)).toEqual(["Push"]);
    expect(sessionOf(version, "Push").session_id).not.toBe(oldId);
  });
});
