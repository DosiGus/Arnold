import { describe, expect, it } from "vitest";
import { harness, itemOf, type Harness } from "./fixtures/arnold-plan";
import { canonical } from "../src/server/workout/infrastructure";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { buildArnoldDashboardAnalytics } from "../src/analytics";

async function newVersion(h: Harness, source = "pfx-v2") {
  return (
    await h.ok("create_plan_version", {
      request_id: `cv-${Math.random().toString(36).slice(2)}`,
      source_plan_version_id: source,
    })
  ).plan!.version;
}

const confirm = (v: { plan_version_id: string; row_revision: number }) => ({
  plan_version_id: v.plan_version_id,
  row_revision: v.row_revision,
  confirmed: true as const,
});

describe("plan history and comparison", () => {
  it("lists every version newest first with its lifecycle stamps", async () => {
    const h = harness();
    const history = await h.plans.history();
    expect(history.entries.map((e) => e.version.version_no)).toEqual([2, 1]);
    const [current, previous] = history.entries;
    expect(current.version.status).toBe("active");
    expect(current.version.activated_at_utc).toBe("2026-04-01T06:00:00Z");
    expect(current.change_count_vs_active).toBeNull();
    expect(previous.version.status).toBe("archived");
    expect(previous.version.retired_at_utc).toBe("2026-04-01T06:00:00Z");
    // The distance to the current plan is what makes a history actionable.
    expect(previous.change_count_vs_active).toBeGreaterThan(0);
    expect(previous.reusable).toBe(true);
  });

  it("reports how many workouts each version carries", async () => {
    const h = harness();
    const history = await h.plans.history();
    expect(
      Object.fromEntries(
        history.entries.map((e) => [
          e.version.plan_version_id,
          e.version.workout_count,
        ]),
      ),
    ).toEqual({ "pfx-v1": 1, "pfx-v2": 1 });
  });

  it("groups versions into families and names the active one", async () => {
    const h = harness();
    const list = await h.plans.list();
    expect(list.families).toHaveLength(1);
    expect(list.families[0].plan_family_id).toBe("pfx-family-ppl");
    expect(list.families[0].active_plan_version_id).toBe("pfx-v2");
    expect(list.families[0].latest_version_no).toBe(2);
    expect(list.total_versions).toBe(2);
  });

  it("lists a second independent routine separately", async () => {
    const h = harness();
    await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Oberkörper/Unterkörper",
      sessions: [
        {
          session_name: "Oberkörper A",
          exercises: [{ exercise_id: "plan-fx-bench" }],
        },
        {
          session_name: "Unterkörper A",
          exercises: [{ exercise_id: "plan-fx-squat" }],
        },
      ],
    });
    const list = await h.plans.list();
    expect(list.families).toHaveLength(2);
    // The family holding the active plan is listed first.
    expect(list.families[0].active_plan_version_id).toBe("pfx-v2");
    expect(list.families[1].active_plan_version_id).toBeNull();
  });

  it("filters a listing by status", async () => {
    const h = harness();
    const drafts = await h.plans.list({ statuses: ["draft"] });
    expect(drafts.families).toHaveLength(0);
    const archived = await h.plans.list({ statuses: ["archived"] });
    expect(archived.families[0].versions.map((v) => v.plan_version_id)).toEqual(
      ["pfx-v1"],
    );
  });

  it("names added, removed, replaced and reordered exercises", async () => {
    const h = harness();
    const comparison = await h.plans.compare({
      from_plan_version_id: "pfx-v1",
      to_plan_version_id: "pfx-v2",
    });
    expect(comparison.same_family).toBe(true);
    const kinds = comparison.changes.map((c) => c.kind);
    // Version 2 added the incline press, the row, curls, leg press and leg curl.
    expect(comparison.summary.exercises_added).toBe(5);
    expect(kinds).toContain("exercise_reordered");
    expect(comparison.summary.targets_changed).toBeGreaterThan(0);
    expect(comparison.headline.join(" ")).toMatch(/Übungen hinzugefügt/);
    expect(comparison.changes.every((c) => c.label.length > 0)).toBe(true);
  });

  it("detects a replacement rather than a remove plus add", async () => {
    const h = harness();
    const version = await newVersion(h);
    const bench = itemOf(version, "plan-fx-bench", "Push");
    await h.ok("update_plan_draft", {
      request_id: "e1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [
        {
          type: "replace_plan_exercise",
          plan_item_id: bench.plan_item_id,
          new_exercise_id: "plan-fx-db-bench",
        },
      ],
    });
    const comparison = await h.plans.compare({
      from_plan_version_id: "pfx-v2",
      to_plan_version_id: version.plan_version_id,
    });
    expect(comparison.summary.exercises_replaced).toBe(1);
    expect(comparison.summary.exercises_added).toBe(0);
    expect(comparison.summary.exercises_removed).toBe(0);
    const replaced = comparison.changes.find(
      (c) => c.kind === "exercise_replaced",
    )!;
    expect(replaced.before).toBe("Demo Bankdrücken");
    expect(replaced.after).toBe("Demo Kurzhantel-Bankdrücken");
    expect(replaced.label).toMatch(/ersetzt durch/);
  });

  it("detects a renamed session without calling it added and removed", async () => {
    const h = harness();
    const version = await newVersion(h);
    await h.ok("update_plan_draft", {
      request_id: "e1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [
        {
          type: "rename_session",
          session_id: "pfx-s-push",
          session_name: "Oberkörper A",
        },
      ],
    });
    const comparison = await h.plans.compare({
      from_plan_version_id: "pfx-v2",
      to_plan_version_id: version.plan_version_id,
    });
    expect(comparison.summary.sessions_renamed).toBe(1);
    expect(comparison.summary.sessions_added).toBe(0);
    expect(comparison.summary.sessions_removed).toBe(0);
  });

  it("reports no differences between a version and itself", async () => {
    const h = harness();
    const comparison = await h.plans.compare({
      from_plan_version_id: "pfx-v2",
      to_plan_version_id: "pfx-v2",
    });
    expect(comparison.changes).toHaveLength(0);
    expect(comparison.headline).toEqual(["Keine inhaltlichen Unterschiede."]);
  });

  it("compares across families by session name", async () => {
    const h = harness();
    const version = await newVersion(h);
    const cloned = (
      await h.ok("create_plan_version", {
        request_id: "cv2",
        source_plan_version_id: "pfx-v2",
        as_new_family: true,
      })
    ).plan!.version;
    const comparison = await h.plans.compare({
      from_plan_version_id: version.plan_version_id,
      to_plan_version_id: cloned.plan_version_id,
    });
    expect(comparison.same_family).toBe(false);
    // Different ids, identical content: sessions still match on their names.
    expect(comparison.changes).toHaveLength(0);
  });

  it("rejects comparing a version that does not exist", async () => {
    const h = harness();
    await expect(
      h.plans.compare({
        from_plan_version_id: "pfx-v2",
        to_plan_version_id: "ghost",
      }),
    ).rejects.toThrow(/existiert nicht/);
  });
});

describe("historical data stays intact across a plan change", () => {
  it("leaves the old workout on the old plan version after a swap", async () => {
    const h = harness();
    const before = await h.dataset();
    const oldWorkout = before.workouts.find((w) => w.workout_id === "pfx-w1")!;
    const oldSets = canonical(
      before.sets.filter((s) => s.workout_id === "pfx-w1"),
    );

    // Replace the barbell bench with the dumbbell variant and activate.
    const version = await newVersion(h);
    const bench = itemOf(version, "plan-fx-bench", "Push");
    const edited = (
      await h.ok("update_plan_draft", {
        request_id: "e1",
        plan_version_id: version.plan_version_id,
        expected_row_revision: version.row_revision,
        edits: [
          {
            type: "replace_plan_exercise",
            plan_item_id: bench.plan_item_id,
            new_exercise_id: "plan-fx-db-bench",
          },
        ],
      })
    ).plan!.version;
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: edited.plan_version_id,
      expected_row_revision: edited.row_revision,
      confirmation: confirm(edited),
    });

    const after = await h.dataset();
    // The historical workout still points at V1 and its sets are unchanged.
    const stillOld = after.workouts.find((w) => w.workout_id === "pfx-w1")!;
    expect(canonical(stillOld)).toBe(canonical(oldWorkout));
    expect(stillOld.plan_version_id).toBe("pfx-v1");
    expect(canonical(after.sets.filter((s) => s.workout_id === "pfx-w1"))).toBe(
      oldSets,
    );
    // The old barbell sets survive with their original loads.
    const barbell = after.sets.filter((s) => s.exercise_id === "plan-fx-bench");
    expect(barbell.map((s) => s.load_kg)).toEqual([70, 70, 75, 75]);
  });

  it("keeps the session name snapshot after a rename", async () => {
    const h = harness();
    const version = await newVersion(h);
    const edited = (
      await h.ok("update_plan_draft", {
        request_id: "e1",
        plan_version_id: version.plan_version_id,
        expected_row_revision: version.row_revision,
        edits: [
          {
            type: "rename_session",
            session_id: "pfx-s-push",
            session_name: "Oberkörper A",
          },
        ],
      })
    ).plan!.version;
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: edited.plan_version_id,
      expected_row_revision: edited.row_revision,
      confirmation: confirm(edited),
    });
    const data = await h.dataset();
    // The historical display name is not rewritten by a later rename.
    for (const workout of data.workouts)
      expect(workout.session_name_snapshot).toBe("Push");
    // And the old versions still say "Push" too.
    expect(
      data.planItems
        .filter(
          (i) =>
            i.plan_version_id === "pfx-v2" && i.session_id === "pfx-s-push",
        )
        .every((i) => i.session_name === "Push"),
    ).toBe(true);
  });

  it("never rewrites a logged weight when a target weight changes", async () => {
    const h = harness();
    const logged = canonical(
      (await h.dataset()).sets.map((s) => [s.set_id, s.load_kg]),
    );
    const version = await newVersion(h);
    const bench = itemOf(version, "plan-fx-bench", "Push");
    await h.ok("update_plan_draft", {
      request_id: "e1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [
        {
          type: "update_plan_exercise_targets",
          plan_item_id: bench.plan_item_id,
          targets: { target_load_kg: 200 },
        },
      ],
    });
    expect(
      canonical((await h.dataset()).sets.map((s) => [s.set_id, s.load_kg])),
    ).toBe(logged);
  });

  it("keeps a running workout on its original plan version", async () => {
    const h = harness();
    // A workout is started against the active plan, then the plan changes.
    const started = await h.service.startWorkout({
      request_id: "w-start",
      workout_date_local: "2026-06-01",
      timezone: "Europe/Berlin",
      session_name: "Push",
    });
    expect(started.ok).toBe(true);
    const workout = started.result!.workout!;
    expect(workout.plan_version_id).toBe("pfx-v2");
    expect(workout.session_id).toBe("pfx-s-push");

    const version = await newVersion(h);
    const bench = itemOf(version, "plan-fx-bench", "Push");
    const edited = (
      await h.ok("update_plan_draft", {
        request_id: "e1",
        plan_version_id: version.plan_version_id,
        expected_row_revision: version.row_revision,
        edits: [
          {
            type: "replace_plan_exercise",
            plan_item_id: bench.plan_item_id,
            new_exercise_id: "plan-fx-db-bench",
          },
        ],
      })
    ).plan!.version;
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: edited.plan_version_id,
      expected_row_revision: edited.row_revision,
      confirmation: confirm(edited),
    });

    const data = await h.dataset();
    const running = data.workouts.find(
      (w) => w.workout_id === workout.workout_id,
    )!;
    expect(running.status).toBe("in_progress");
    // The exercises of a running workout are not silently swapped.
    expect(running.plan_version_id).toBe("pfx-v2");
    expect(running.session_id).toBe("pfx-s-push");
  });

  it("lets a new workout use the newly activated version", async () => {
    const h = harness();
    const version = await newVersion(h);
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    const started = await h.service.startWorkout({
      request_id: "w-start",
      workout_date_local: "2026-06-01",
      timezone: "Europe/Berlin",
      session_name: "Push",
    });
    expect(started.ok).toBe(true);
    expect(started.result!.workout!.plan_version_id).toBe(
      version.plan_version_id,
    );
  });

  it("can still log sets after a plan change", async () => {
    const h = harness();
    const version = await newVersion(h);
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    const started = await h.service.startWorkout({
      request_id: "w1",
      workout_date_local: "2026-06-01",
      timezone: "Europe/Berlin",
      session_name: "Push",
    });
    const logged = await h.service.logWorkoutSets({
      request_id: "w2",
      workout_id: started.result!.workout!.workout_id,
      sets: [
        {
          exercise_id: "plan-fx-bench",
          set_type: "working",
          reps: 8,
          reps_basis: "total",
          load_kg: 80,
          load_basis: "total",
          implement_count: 1,
          execution_mode: "bilateral_simultaneous",
          side: "both",
        },
      ],
    });
    expect(logged.error).toBeNull();
    expect(logged.result!.sets[0].load_kg).toBe(80);
  });

  it("keeps analytics working across plan versions", async () => {
    const h = harness();
    const version = await newVersion(h);
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: confirm(version),
    });
    const data = await h.dataset();
    const analysis = buildArnoldDashboardAnalytics(data, {
      reference_date: "2026-06-01",
    });
    // Both historical workouts remain countable after the switch.
    expect(analysis.activity.completed_workouts.value).toBe(2);
    // The plan windows span all three versions that were ever in force.
    const view = buildDashboardView(
      data,
      {
        generatedAt: "2026-06-01T08:00:00.000Z",
        mode: { mode: "arnold", label: "Test", description: "Test" },
      },
      { reference_date: "2026-06-01" },
    );
    expect(view.active_plan).not.toBeNull();
    expect(view.active_plan!.plan_version_id).toBe(version.plan_version_id);
    // The dashboard history still lists every version that ever existed.
    expect(view.plan_history.map((p) => p.plan_version_id).sort()).toEqual(
      ["pfx-v1", "pfx-v2", version.plan_version_id].sort(),
    );
  });

  it("still evaluates an exercise that a later version dropped", async () => {
    const h = harness();
    const version = await newVersion(h);
    const lateral = itemOf(version, "plan-fx-lateral", "Push");
    const edited = (
      await h.ok("update_plan_draft", {
        request_id: "e1",
        plan_version_id: version.plan_version_id,
        expected_row_revision: version.row_revision,
        edits: [
          { type: "remove_plan_exercise", plan_item_id: lateral.plan_item_id },
        ],
      })
    ).plan!.version;
    await h.ok("activate_training_plan", {
      request_id: "act1",
      plan_version_id: edited.plan_version_id,
      expected_row_revision: edited.row_revision,
      confirmation: confirm(edited),
    });
    const data = await h.dataset();
    // The historical plan positions for the dropped exercise are still there.
    expect(
      data.planItems.filter(
        (i) => i.exercise_id === "plan-fx-lateral" && i.status === "active",
      ).length,
    ).toBeGreaterThan(0);
    // And the catalog entry is untouched.
    expect(
      data.exercises.find((e) => e.exercise_id === "plan-fx-lateral")!.status,
    ).toBe("active");
  });
});
