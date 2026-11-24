/**
 * MOB-004: mobility sessions in the plan. Synthetic data only.
 *
 * The plan service takes the three operations (add, update, remove), lets the
 * timing engine compute the seconds, keeps the session_id space shared with
 * strength and run sessions, and carries mobility through cloning,
 * activation, comparison and the adjustment for a while.
 */
import { describe, expect, it } from "vitest";
import {
  createFixturePlanning,
  planFixtureDataset,
} from "../src/server/plan/fixture";
import {
  ArnoldMobilityProfileSchema,
  type ArnoldDataset,
} from "../src/shared/arnold-schema-v1";
import {
  PlanWriteResponseSchema,
  type PlanValidationResult,
  type PlanWriteOperation,
  type TrainingPlanVersion,
} from "../src/shared/plan-contract";
import { PlanAdjustmentWriteResponseSchema } from "../src/shared/plan-adjustment-contract";
import { planChangeRows } from "../src/shared/plan-change-rows";
import {
  canonical,
  changedDataset,
  WriteError,
  type InMemoryAuditLog,
} from "../src/server/workout/infrastructure";
import { mobilityValidationIssues } from "../src/server/plan/mobility-validation";
import {
  mobilityCatalogRows,
  mobilityCatalogText,
} from "../src/server/plan/mobility-sessions";
import { harness, NOW, type Harness } from "./fixtures/arnold-plan";

/** Standing exercises (morning), then mat exercises (session). */
const M = [
  "mob_neck_rolls",
  "mob_neck_side",
  "mob_shoulder_circles",
  "mob_arm_circles",
  "mob_doorway_chest",
  "mob_wall_slides",
  "mob_standing_rotation",
];
const F = [
  "mob_cat_cow",
  "mob_childs_pose",
  "mob_thread_needle",
  "mob_open_book",
  "mob_worlds_greatest",
  "mob_kneeling_hip_flexor",
  "mob_pigeon",
  "mob_90_90",
];

const morning = (extra: Record<string, unknown> = {}) => ({
  type: "add_mobility_session",
  kind: "morning",
  session_name: "Morgenroutine",
  minutes: 10,
  exercise_ids: M.slice(0, 5),
  weekdays: [5, 1, 3],
  ...extra,
});
const mobSession = (extra: Record<string, unknown> = {}) => ({
  type: "add_mobility_session",
  kind: "session",
  session_name: "Beweglichkeit",
  minutes: 20,
  exercise_ids: F.slice(0, 7),
  weekdays: [6],
  ...extra,
});

/** A draft of the active plan (same family, session ids kept). */
async function newDraft(h: Harness) {
  const result = await h.ok("create_plan_version", {
    request_id: `cv-${Math.random().toString(36).slice(2)}`,
    source_plan_version_id: "pfx-v2",
  });
  return result.plan!.version;
}

const call = (
  version: { plan_version_id: string; row_revision: number },
  edits: unknown[],
) => ({
  request_id: `e-${Math.random().toString(36).slice(2)}`,
  plan_version_id: version.plan_version_id,
  expected_row_revision: version.row_revision,
  edits,
});

async function edit(
  h: Harness,
  version: { plan_version_id: string; row_revision: number },
  ...edits: unknown[]
) {
  const result = await h.ok("update_plan_draft", call(version, edits));
  return result.plan!.version;
}
const rejected = (
  h: Harness,
  version: { plan_version_id: string; row_revision: number },
  ...edits: unknown[]
) => h.fails("update_plan_draft", call(version, edits));

const mobilityRows = async (h: Harness, planVersionId?: string) =>
  ((await h.dataset()).planMobilitySessions ?? []).filter(
    (row) => !planVersionId || row.plan_version_id === planVersionId,
  );

const activate = (h: Harness, version: TrainingPlanVersion) =>
  h.ok("activate_training_plan", {
    request_id: `act-${Math.random().toString(36).slice(2)}`,
    plan_version_id: version.plan_version_id,
    expected_row_revision: version.row_revision,
    confirmation: {
      plan_version_id: version.plan_version_id,
      row_revision: version.row_revision,
      confirmed: true as const,
    },
  });

const mobilityOf = (version: TrainingPlanVersion, name: string) => {
  const found = (version.mobility_sessions ?? []).find(
    (s) => s.session_name === name && s.status === "active",
  );
  if (!found) throw new Error(`No mobility session ${name}`);
  return found;
};

describe("adding mobility sessions", () => {
  it("adds a morning routine on chosen weekdays and times it on the server", async () => {
    const h = harness();
    const before = await newDraft(h);
    const version = await edit(h, before, morning());
    const row = mobilityOf(version, "Morgenroutine");
    expect(row).toMatchObject({
      kind: "morning",
      placement: "own_day",
      after_session_id: null,
      minutes: 10,
      weekdays: [1, 3, 5],
      session_order: 1,
      status: "active",
      row_revision: 1,
    });
    expect(row.template.catalog_version).toBe("mob-1");
    expect(row.template.rules_version).toBe("mob-timing-1");
    expect(row.template.exercise_ids).toEqual(M.slice(0, 5));
    expect(row.template.items).toHaveLength(5);
    // The seconds are Arnold's: a multiple of 5 each, the total near 10 minutes.
    for (const item of row.template.items)
      expect(item.seconds_per_side % 5).toBe(0);
    expect(Math.abs(row.template.total_s - 600)).toBeLessThanOrEqual(60);
    // The strength counts stay strength only.
    expect(version.session_count).toBe(before.session_count);
    expect(version.exercise_count).toBe(before.exercise_count);
    expect((await mobilityRows(h, version.plan_version_id)).length).toBe(1);
  });

  it("adds a mobility session on its own day and one after a strength session", async () => {
    const h = harness();
    const version = await edit(
      h,
      await newDraft(h),
      mobSession(),
      mobSession({
        session_name: "Nach dem Push",
        minutes: 15,
        exercise_ids: F.slice(0, 6),
        weekdays: undefined,
        placement: "after_strength",
        after_session_id: "pfx-s-push",
      }),
    );
    expect(mobilityOf(version, "Beweglichkeit")).toMatchObject({
      placement: "own_day",
      weekdays: [6],
      after_session_id: null,
      session_order: 1,
    });
    expect(mobilityOf(version, "Nach dem Push")).toMatchObject({
      placement: "after_strength",
      weekdays: [],
      after_session_id: "pfx-s-push",
      session_order: 2,
    });
  });

  it("takes the placement from after_session_id when none is stated", async () => {
    const h = harness();
    const version = await edit(
      h,
      await newDraft(h),
      mobSession({ weekdays: undefined, after_session_id: "pfx-s-pull" }),
    );
    expect(mobilityOf(version, "Beweglichkeit").placement).toBe(
      "after_strength",
    );
  });

  it("gives the same routine for the same input", async () => {
    const h = harness();
    const a = await edit(h, await newDraft(h), morning());
    const b = await edit(h, await newDraft(h), morning());
    expect(mobilityOf(a, "Morgenroutine").template).toEqual(
      mobilityOf(b, "Morgenroutine").template,
    );
  });

  it("does not accept seconds from the model", async () => {
    const h = harness();
    const version = await newDraft(h);
    const error = await rejected(
      h,
      version,
      morning({ template: { total_s: 600 }, seconds_per_side: 60 }),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(await mobilityRows(h, version.plan_version_id)).toHaveLength(0);
  });

  it("does not accept an exercise outside the mobility catalog", async () => {
    const h = harness();
    const error = await rejected(
      h,
      await newDraft(h),
      morning({ exercise_ids: ["mob_nonsense", ...M.slice(0, 4)] }),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});

describe("the rules of a mobility session", () => {
  it("lets the timing engine's error codes through, one by one", async () => {
    const h = harness();
    const version = await newDraft(h);
    const cases: [string, Record<string, unknown>][] = [
      ["MOBILITY_BAD_MINUTES", morning({ minutes: 20 })],
      [
        "MOBILITY_TOO_MANY_EXERCISES",
        morning({ minutes: 5, exercise_ids: M.slice(0, 6) }),
      ],
      [
        "MOBILITY_TOO_FEW_EXERCISES",
        morning({ minutes: 15, exercise_ids: M.slice(0, 3) }),
      ],
      [
        "MOBILITY_NOT_MORNING_SUITABLE",
        morning({ exercise_ids: [...M.slice(0, 4), "mob_cat_cow"] }),
      ],
      [
        "MOBILITY_DUPLICATE_EXERCISE",
        morning({ exercise_ids: [M[0], M[0], ...M.slice(1, 4)] }),
      ],
      [
        "MOBILITY_BUDGET_UNREACHABLE",
        mobSession({
          minutes: 30,
          exercise_ids: [
            "mob_wrist_circles",
            "mob_cobra",
            "mob_leg_swing_side",
            "mob_ankle_circles",
            "mob_ankle_rock",
            "mob_quadruped_hip_circles",
            "mob_leg_swing_front",
            "mob_neck_rolls",
            "mob_hip_circles",
          ],
        }),
      ],
    ];
    const before = canonical(await h.dataset());
    for (const [code, spec] of cases) {
      const error = await rejected(h, version, spec);
      expect(error.code, code).toBe("VALIDATION_ERROR");
      expect(error.details[0], code).toMatch(new RegExp(`^${code}: `));
    }
    expect(canonical(await h.dataset())).toBe(before);
  });

  it("writes nothing of a batch when one operation in it fails", async () => {
    const h = harness();
    const version = await newDraft(h);
    const before = canonical(await h.dataset());
    const error = await rejected(
      h,
      version,
      {
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
      },
      morning(),
      morning({ session_name: "Zweite", minutes: 99 }),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(canonical(await h.dataset())).toBe(before);
  });

  it("needs weekdays for a morning routine, and its own days", async () => {
    const h = harness();
    const version = await newDraft(h);
    for (const spec of [
      morning({ weekdays: undefined }),
      morning({ weekdays: [] }),
      morning({ weekdays: [1, 1] }),
      morning({ placement: "after_strength", after_session_id: "pfx-s-push" }),
    ])
      expect((await rejected(h, version, spec)).code).toBe("VALIDATION_ERROR");
  });

  it("lets a morning routine take all seven days", async () => {
    const h = harness();
    const version = await edit(
      h,
      await newDraft(h),
      morning({ weekdays: [7, 6, 5, 4, 3, 2, 1] }),
    );
    expect(mobilityOf(version, "Morgenroutine").weekdays).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("gives an own-day session exactly one weekday", async () => {
    const h = harness();
    const version = await newDraft(h);
    for (const weekdays of [[], [2, 4], undefined])
      expect((await rejected(h, version, mobSession({ weekdays }))).code).toBe(
        "VALIDATION_ERROR",
      );
  });

  it("follows only an active strength session of the same version", async () => {
    const h = harness();
    const version = await newDraft(h);
    const after = (extra: Record<string, unknown>) =>
      mobSession({
        weekdays: undefined,
        placement: "after_strength",
        ...extra,
      });
    // No anchor at all.
    expect((await rejected(h, version, after({}))).code).toBe(
      "VALIDATION_ERROR",
    );
    // A foreign id.
    expect(
      (await rejected(h, version, after({ after_session_id: "not-mine" })))
        .code,
    ).toBe("SESSION_NOT_FOUND");
    // A weekday as well is a contradiction.
    expect(
      (
        await rejected(
          h,
          version,
          after({ after_session_id: "pfx-s-push", weekdays: [2] }),
        )
      ).code,
    ).toBe("VALIDATION_ERROR");
    // A run session is not a strength session.
    const withRun = await edit(h, version, {
      type: "add_run_session",
      session_name: "Grundlage",
      run_type: "base",
      preferred_weekday: 2,
    });
    const runId = withRun.run_sessions![0].session_id;
    expect(
      (await rejected(h, withRun, after({ after_session_id: runId }))).code,
    ).toBe("SESSION_NOT_FOUND");
  });

  it("allows one morning routine and four mobility sessions at most", async () => {
    const h = harness();
    let version = await edit(h, await newDraft(h), morning());
    expect(
      (await rejected(h, version, morning({ session_name: "Noch eine" })))
        .message,
    ).toMatch(/Morgenroutine/);
    version = await edit(
      h,
      version,
      mobSession({ session_name: "A", weekdays: [2] }),
      mobSession({ session_name: "B", weekdays: [4] }),
      mobSession({ session_name: "C", weekdays: [6] }),
    );
    expect(version.mobility_sessions).toHaveLength(4);
    expect(
      (await rejected(h, version, mobSession({ session_name: "D" }))).message,
    ).toMatch(/höchstens 4/);
  });

  it("shares one name space with strength and run sessions", async () => {
    const h = harness();
    let version = await newDraft(h);
    // Strength name, in a different spelling.
    expect(
      (await rejected(h, version, morning({ session_name: " push " }))).code,
    ).toBe("VALIDATION_ERROR");
    version = await edit(
      h,
      version,
      {
        type: "add_run_session",
        session_name: "Tempo",
        run_type: "tempo",
        preferred_weekday: 4,
      },
      morning(),
    );
    expect(
      (await rejected(h, version, mobSession({ session_name: "tempo" }))).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      (
        await rejected(
          h,
          version,
          mobSession({ session_name: "MORGENROUTINE" }),
        )
      ).code,
    ).toBe("VALIDATION_ERROR");
    // And the other way round: a new strength day cannot take a mobility name.
    expect(
      (
        await rejected(h, version, {
          type: "add_session",
          session_name: "Morgenroutine",
          exercises: [
            {
              exercise_id: "plan-fx-curl",
              target_sets: 3,
              rep_min: 10,
              rep_max: 12,
            },
          ],
        })
      ).code,
    ).toBe("VALIDATION_ERROR");
  });
});

describe("one session_id space for strength, run and mobility", () => {
  function forced() {
    let counter = 0;
    let force: string | null = null;
    const runtime = createFixturePlanning(planFixtureDataset("active_ppl"), {
      id: () => force ?? `gen-${String(++counter).padStart(3, "0")}`,
      clock: () => new Date(NOW),
    });
    const write = async (
      operation: PlanWriteOperation,
      input: Record<string, unknown>,
    ) =>
      PlanWriteResponseSchema.parse(
        await runtime.plans.execute(operation, input),
      );
    return { write, force: (id: string | null) => (force = id) };
  }

  it("refuses an id that a strength or run session already has", async () => {
    const f = forced();
    const created = await f.write("create_plan_version", {
      request_id: "c1",
      source_plan_version_id: "pfx-v2",
    });
    let version = created.result!.plan!.version;
    // Collision with a strength session.
    f.force("pfx-s-pull");
    let response = await f.write(
      "update_plan_draft",
      call(version, [morning()]),
    );
    expect(response.ok).toBe(false);
    expect(response.error!.message).toMatch(/schon vergeben/);
    // Collision with a run session.
    f.force(null);
    response = await f.write(
      "update_plan_draft",
      call(version, [
        {
          type: "add_run_session",
          session_name: "Grundlage",
          run_type: "base",
          preferred_weekday: 2,
        },
      ]),
    );
    expect(response.ok).toBe(true);
    version = response.result!.plan!.version;
    const runId = version.run_sessions![0].session_id;
    f.force(runId);
    response = await f.write("update_plan_draft", call(version, [morning()]));
    expect(response.ok).toBe(false);
    expect(response.error!.message).toMatch(/schon vergeben/);
    // And a mobility id cannot be taken by a run session either.
    f.force(null);
    response = await f.write("update_plan_draft", call(version, [morning()]));
    expect(response.ok).toBe(true);
    version = response.result!.plan!.version;
    f.force(version.mobility_sessions![0].session_id);
    response = await f.write(
      "update_plan_draft",
      call(version, [
        {
          type: "add_run_session",
          session_name: "Tempo",
          run_type: "tempo",
          preferred_weekday: 4,
        },
      ]),
    );
    expect(response.ok).toBe(false);
    expect(response.error!.message).toMatch(/schon vergeben/);
  });
});

describe("updating and removing mobility sessions", () => {
  it("updates a morning routine: weekdays, length, exercises, name", async () => {
    const h = harness();
    const added = await edit(h, await newDraft(h), morning());
    const first = mobilityOf(added, "Morgenroutine");
    const version = await edit(h, added, {
      type: "update_mobility_session",
      session_id: first.session_id,
      session_name: "Aufwachen",
      minutes: 15,
      exercise_ids: M.slice(0, 6),
      weekdays: [2, 4],
    });
    const row = mobilityOf(version, "Aufwachen");
    expect(row).toMatchObject({
      session_id: first.session_id,
      kind: "morning",
      minutes: 15,
      weekdays: [2, 4],
      row_revision: 2,
    });
    expect(row.template.exercise_ids).toEqual(M.slice(0, 6));
    expect(row.template.total_s).toBeGreaterThan(first.template.total_s);
    expect(version.mobility_sessions).toHaveLength(1);
  });

  it("updates a session and moves it between own day and after strength", async () => {
    const h = harness();
    const added = await edit(h, await newDraft(h), mobSession());
    const id = mobilityOf(added, "Beweglichkeit").session_id;
    let version = await edit(h, added, {
      type: "update_mobility_session",
      session_id: id,
      placement: "after_strength",
      after_session_id: "pfx-s-legs",
    });
    expect(mobilityOf(version, "Beweglichkeit")).toMatchObject({
      placement: "after_strength",
      weekdays: [],
      after_session_id: "pfx-s-legs",
    });
    version = await edit(h, version, {
      type: "update_mobility_session",
      session_id: id,
      placement: "own_day",
      weekdays: [3],
    });
    expect(mobilityOf(version, "Beweglichkeit")).toMatchObject({
      placement: "own_day",
      weekdays: [3],
      after_session_id: null,
    });
    // Back to the other placement without its fields is a clear error.
    const error = await rejected(h, version, {
      type: "update_mobility_session",
      session_id: id,
      placement: "after_strength",
    });
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("re-times only when length or exercises change, and rejects timing errors", async () => {
    const h = harness();
    const added = await edit(h, await newDraft(h), morning());
    const row = mobilityOf(added, "Morgenroutine");
    // A pure rename keeps the stored routine byte for byte.
    const renamed = await edit(h, added, {
      type: "update_mobility_session",
      session_id: row.session_id,
      session_name: "Früh",
    });
    expect(mobilityOf(renamed, "Früh").template).toEqual(row.template);
    const before = canonical(await h.dataset());
    const error = await rejected(h, renamed, {
      type: "update_mobility_session",
      session_id: row.session_id,
      minutes: 15,
    });
    expect(error.details[0]).toMatch(/^MOBILITY_TOO_FEW_EXERCISES: /);
    expect(canonical(await h.dataset())).toBe(before);
  });

  it("refuses a name another session of the version already has", async () => {
    const h = harness();
    const added = await edit(
      h,
      await newDraft(h),
      morning(),
      mobSession({ weekdays: [6] }),
    );
    const error = await rejected(h, added, {
      type: "update_mobility_session",
      session_id: mobilityOf(added, "Beweglichkeit").session_id,
      session_name: "morgenroutine",
    });
    expect(error.code).toBe("VALIDATION_ERROR");
    // Keeping its own name is fine.
    await edit(h, added, {
      type: "update_mobility_session",
      session_id: mobilityOf(added, "Beweglichkeit").session_id,
      session_name: "Beweglichkeit",
    });
  });

  it("removes a morning routine and a session, and the field disappears with the last", async () => {
    const h = harness();
    const added = await edit(
      h,
      await newDraft(h),
      morning(),
      mobSession({ weekdays: [6] }),
    );
    const morningId = mobilityOf(added, "Morgenroutine").session_id;
    const sessionId = mobilityOf(added, "Beweglichkeit").session_id;
    let version = await edit(h, added, {
      type: "remove_mobility_session",
      session_id: morningId,
    });
    expect(version.mobility_sessions!.map((s) => s.session_name)).toEqual([
      "Beweglichkeit",
    ]);
    // The remaining one moves up in the order.
    expect(version.mobility_sessions![0].session_order).toBe(1);
    version = await edit(h, version, {
      type: "remove_mobility_session",
      session_id: sessionId,
    });
    expect("mobility_sessions" in version).toBe(false);
    // Nothing is deleted: both rows stay, as removed.
    const rows = await mobilityRows(h, version.plan_version_id);
    expect(rows.map((r) => r.status).sort()).toEqual(["removed", "removed"]);
    // Removing again, or an unknown id, is an error.
    expect(
      (
        await rejected(h, version, {
          type: "remove_mobility_session",
          session_id: sessionId,
        })
      ).code,
    ).toBe("SESSION_NOT_FOUND");
    expect(
      (
        await rejected(h, version, {
          type: "update_mobility_session",
          session_id: "nope",
          minutes: 10,
        })
      ).code,
    ).toBe("SESSION_NOT_FOUND");
  });

  it("frees the name and the morning slot of a removed routine", async () => {
    const h = harness();
    const added = await edit(h, await newDraft(h), morning());
    const gone = await edit(h, added, {
      type: "remove_mobility_session",
      session_id: mobilityOf(added, "Morgenroutine").session_id,
    });
    const again = await edit(h, gone, morning());
    expect(again.mobility_sessions).toHaveLength(1);
  });
});

describe("a strength session that mobility follows", () => {
  async function withAnchor(h: Harness) {
    return edit(
      h,
      await newDraft(h),
      mobSession({
        session_name: "Nach dem Push",
        weekdays: undefined,
        after_session_id: "pfx-s-push",
      }),
    );
  }

  it("cannot be removed, nor emptied, nor replaced wholesale", async () => {
    const h = harness();
    const version = await withAnchor(h);
    const before = canonical(await h.dataset());
    const removal = await rejected(h, version, {
      type: "remove_session",
      session_id: "pfx-s-push",
    });
    expect(removal.code).toBe("VALIDATION_ERROR");
    expect(removal.message).toMatch(/Push/);
    expect(removal.message).toMatch(/Nach dem Push/);
    const pushItems = version.sessions
      .find((s) => s.session_id === "pfx-s-push")!
      .exercises.filter((e) => e.status === "active");
    expect(
      (
        await rejected(
          h,
          version,
          ...pushItems.map((e) => ({
            type: "remove_plan_exercise",
            plan_item_id: e.plan_item_id,
          })),
        )
      ).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      (
        await rejected(h, version, {
          type: "replace_draft_sessions",
          sessions: [
            {
              session_name: "Neu",
              exercises: [{ exercise_id: "plan-fx-curl", target_sets: 3 }],
            },
          ],
        })
      ).code,
    ).toBe("VALIDATION_ERROR");
    expect(canonical(await h.dataset())).toBe(before);
  });

  it("can be removed once the mobility session is moved or removed first", async () => {
    const h = harness();
    const version = await withAnchor(h);
    const mobility = mobilityOf(version, "Nach dem Push");
    const done = await edit(
      h,
      version,
      { type: "remove_mobility_session", session_id: mobility.session_id },
      { type: "remove_session", session_id: "pfx-s-push" },
    );
    expect(done.sessions.some((s) => s.session_id === "pfx-s-push")).toBe(
      false,
    );
    expect(done.mobility_sessions).toBeUndefined();
    // Or the mobility session takes another anchor.
    const again = await withAnchor(h);
    const moved = await edit(
      h,
      again,
      {
        type: "update_mobility_session",
        session_id: mobilityOf(again, "Nach dem Push").session_id,
        after_session_id: "pfx-s-pull",
      },
      { type: "remove_session", session_id: "pfx-s-push" },
    );
    expect(mobilityOf(moved, "Nach dem Push").after_session_id).toBe(
      "pfx-s-pull",
    );
  });

  it("can be renamed and duplicated without touching the mobility session", async () => {
    const h = harness();
    const version = await withAnchor(h);
    const next = await edit(
      h,
      version,
      {
        type: "rename_session",
        session_id: "pfx-s-push",
        session_name: "Druck",
      },
      { type: "duplicate_session", session_id: "pfx-s-push" },
    );
    expect(mobilityOf(next, "Nach dem Push").after_session_id).toBe(
      "pfx-s-push",
    );
  });
});

describe("cloning and activating", () => {
  async function activeWithMobility(h: Harness) {
    const version = await edit(
      h,
      await newDraft(h),
      morning(),
      mobSession({
        session_name: "Nach dem Pull",
        weekdays: undefined,
        after_session_id: "pfx-s-pull",
      }),
    );
    h.advance();
    await activate(h, version);
    return version;
  }

  it("keeps mobility through activation and the dataset stays valid", async () => {
    const h = harness();
    const version = await activeWithMobility(h);
    const data = await h.dataset();
    const { ArnoldDatasetSchema } =
      await import("../src/shared/arnold-schema-v1");
    expect(() => ArnoldDatasetSchema.parse(data)).not.toThrow();
    const rows = data.planMobilitySessions!.filter(
      (r) => r.plan_version_id === version.plan_version_id,
    );
    expect(rows).toHaveLength(2);
    const context = await h.plans.context({
      plan_version_id: version.plan_version_id,
    });
    expect(context.plan!.status).toBe("active");
    expect(context.plan!.mobility_sessions).toHaveLength(2);
  });

  it("copies mobility into the next draft of the family with the same session ids", async () => {
    const h = harness();
    const active = await activeWithMobility(h);
    const clone = (
      await h.ok("create_plan_version", {
        request_id: "clone-1",
        source_plan_version_id: active.plan_version_id,
      })
    ).plan!.version;
    expect(clone.status).toBe("draft");
    const strip = (s: NonNullable<typeof clone.mobility_sessions>[number]) => ({
      ...s,
      plan_mobility_session_id: "-",
    });
    expect(clone.mobility_sessions!.map(strip)).toEqual(
      active.mobility_sessions!.map(strip),
    );
    // New row ids, same session ids and the same timing (no new computation).
    expect(clone.mobility_sessions![0].plan_mobility_session_id).not.toBe(
      active.mobility_sessions![0].plan_mobility_session_id,
    );
    // The source stays as it was.
    const sourceRows = await mobilityRows(h, active.plan_version_id);
    expect(sourceRows).toHaveLength(2);
    expect(sourceRows.every((r) => r.status === "active")).toBe(true);
  });

  it("re-issues session ids for a new family and points after-strength at the new day", async () => {
    const h = harness();
    const active = await activeWithMobility(h);
    const copy = (
      await h.ok("create_plan_version", {
        request_id: "clone-2",
        source_plan_version_id: active.plan_version_id,
        as_new_family: true,
      })
    ).plan!.version;
    const rows = copy.mobility_sessions!;
    expect(rows).toHaveLength(2);
    const oldIds = new Set(active.mobility_sessions!.map((s) => s.session_id));
    for (const row of rows) expect(oldIds.has(row.session_id)).toBe(false);
    const after = rows.find((r) => r.placement === "after_strength")!;
    const anchor = copy.sessions.find(
      (s) => s.session_id === after.after_session_id,
    );
    expect(anchor?.session_name).toBe("Pull");
    expect(after.after_session_id).not.toBe("pfx-s-pull");
    // Every session_id of the copy is unique across strength, run and mobility.
    const all = [
      ...copy.sessions.map((s) => s.session_id),
      ...rows.map((r) => r.session_id),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("does not carry a removed mobility session over", async () => {
    const h = harness();
    const active = await activeWithMobility(h);
    const draft = (
      await h.ok("create_plan_version", {
        request_id: "clone-3",
        source_plan_version_id: active.plan_version_id,
      })
    ).plan!.version;
    const next = await edit(h, draft, {
      type: "remove_mobility_session",
      session_id: mobilityOf(draft, "Morgenroutine").session_id,
    });
    const again = (
      await h.ok("create_plan_version", {
        request_id: "clone-4",
        source_plan_version_id: next.plan_version_id,
      })
    ).plan!.version;
    expect(again.mobility_sessions!.map((s) => s.session_name)).toEqual([
      "Nach dem Pull",
    ]);
  });

  it("never changes an activated version", async () => {
    const h = harness();
    const version = await activeWithMobility(h);
    const before = canonical(await mobilityRows(h, version.plan_version_id));
    const error = await h.fails("update_plan_draft", {
      request_id: "late",
      plan_version_id: version.plan_version_id,
      expected_row_revision: 1,
      edits: [
        {
          type: "remove_mobility_session",
          session_id: mobilityOf(version, "Morgenroutine").session_id,
        },
      ],
    });
    expect(error.code).toBe("PLAN_NOT_EDITABLE");
    expect(canonical(await mobilityRows(h, version.plan_version_id))).toBe(
      before,
    );
    // The store refuses it as well, below the service.
    const data = await h.dataset();
    const row = data.planMobilitySessions!.find(
      (r) => r.plan_version_id === version.plan_version_id,
    )!;
    try {
      changedDataset(data, [
        {
          table: "planMobilitySessions",
          before: row,
          after: {
            ...row,
            session_name: "Verändert",
            row_revision: row.row_revision + 1,
          },
        },
      ]);
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(WriteError);
      expect((error as WriteError).code).toBe("PERMISSION_DENIED");
    }
  });
});

describe("validation", () => {
  it("does not count mobility as training days", async () => {
    const h = harness();
    const draft = await edit(h, await newDraft(h), {
      type: "update_plan_metadata",
      days_per_week: 3,
    });
    const result = await h.ok(
      "update_plan_draft",
      call(draft, [
        morning({ weekdays: [1, 2, 3, 4, 5, 6, 7] }),
        mobSession({ session_name: "A", weekdays: [2] }),
        mobSession({ session_name: "B", weekdays: [4] }),
        mobSession({ session_name: "C", weekdays: [6] }),
      ]),
    );
    const codes = result.validation!.recommendations.map((i) => i.code);
    expect(codes).not.toContain("DAYS_PER_WEEK_MISMATCH");
    expect(result.validation!.valid).toBe(true);
    // The check itself still works: a fourth strength day is reported.
    const withFourth = await h.ok(
      "update_plan_draft",
      call(result.plan!.version, [
        {
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
        },
      ]),
    );
    expect(withFourth.validation!.recommendations.map((i) => i.code)).toContain(
      "DAYS_PER_WEEK_MISMATCH",
    );
  });

  it("does not make a mobility-only plan activatable", async () => {
    const h = harness("empty");
    const created = await h.ok("create_training_plan", {
      request_id: "mo-1",
      name: "Nur Mobility",
      sessions: [
        {
          session_name: "Push",
          exercises: [
            {
              exercise_id: "plan-fx-bench",
              target_sets: 3,
              rep_min: 8,
              rep_max: 12,
            },
          ],
        },
      ],
    });
    const withMobility = await edit(h, created.plan!.version, morning());
    const removed = await edit(h, withMobility, {
      type: "remove_session",
      session_id: withMobility.sessions[0].session_id,
    });
    const validation = await h.plans.validate({
      plan_version_id: removed.plan_version_id,
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((e) => e.code)).toContain("NO_SESSION");
  });
});

describe("hints for mobility sessions", () => {
  const profile = (over: Record<string, unknown> = {}) =>
    ArnoldMobilityProfileSchema.parse({
      mobility_profile_id: "mp-1",
      wants: true,
      morning_weekdays: [1, 2, 3, 4, 5],
      morning_minutes: 10,
      sessions_placement: null,
      sessions_per_week: null,
      sessions_minutes: null,
      stiff_areas: ["calves_ankles"],
      created_at_utc: "2026-06-01T07:00:00.000Z",
      updated_at_utc: "2026-06-01T07:00:00.000Z",
      row_revision: 1,
      ...over,
    });
  const withProfile = (over: Record<string, unknown> = {}) =>
    ({
      ...planFixtureDataset("active_ppl"),
      mobilityProfiles: [profile(over)],
    }) as ArnoldDataset;

  const codes = (r: { validation: PlanValidationResult | null }) =>
    [...r.validation!.recommendations, ...r.validation!.warnings].map(
      (i) => i.code,
    );

  it("asks for the profile when there is none, and never blocks", async () => {
    const h = harness();
    const draft = await newDraft(h);
    const result = await h.ok("update_plan_draft", call(draft, [morning()]));
    expect(codes(result)).toContain("MOBILITY_PROFILE_MISSING");
    expect(result.validation!.valid).toBe(true);
    expect(result.validation!.activatable).toBe(true);
    // No mobility, no hint.
    const plain = await h.ok(
      "update_plan_draft",
      call(await newDraft(h), [
        { type: "update_plan_metadata", name: "Anders" },
      ]),
    );
    expect(codes(plain)).not.toContain("MOBILITY_PROFILE_MISSING");
  });

  it("names a stiff area no exercise covers", async () => {
    const h = harness("active_ppl", { dataset: withProfile() });
    const draft = await newDraft(h);
    const result = await h.ok("update_plan_draft", call(draft, [morning()]));
    const hint = [
      ...result.validation!.recommendations,
      ...result.validation!.warnings,
    ].find((i) => i.code === "MOBILITY_STIFF_AREA_UNCOVERED");
    expect(hint?.message).toMatch(/Waden und Sprunggelenke/);
    expect(codes(result)).not.toContain("MOBILITY_PROFILE_MISSING");
    expect(result.validation!.activatable).toBe(true);
  });

  it("is quiet when the stiff area is covered, or the user does not want mobility", async () => {
    const covered = harness("active_ppl", { dataset: withProfile() });
    const result = await covered.ok(
      "update_plan_draft",
      call(await newDraft(covered), [
        morning({
          exercise_ids: [
            "mob_neck_rolls",
            "mob_shoulder_circles",
            "mob_arm_circles",
            "mob_calf_wall",
            "mob_hip_circles",
          ],
        }),
      ]),
    );
    expect(codes(result)).not.toContain("MOBILITY_STIFF_AREA_UNCOVERED");

    const declined = harness("active_ppl", {
      dataset: withProfile({
        wants: false,
        morning_weekdays: null,
        morning_minutes: null,
        stiff_areas: [],
      }),
    });
    const quiet = await declined.ok(
      "update_plan_draft",
      call(await newDraft(declined), [morning()]),
    );
    expect(codes(quiet).filter((c) => c.startsWith("MOBILITY_"))).toEqual([]);
  });

  it("says 'gently and without pain' for a protected area, mapped to the mobility areas", async () => {
    const h = harness("active_ppl", { dataset: withProfile() });
    const version = await edit(h, await newDraft(h), morning());
    const data = await h.dataset();
    const issues = mobilityValidationIssues(version, data, {
      protectedAreas: ["shoulder", "knee", "elbow"],
    });
    const protectedHint = issues.find(
      (i) => i.code === "MOBILITY_PROTECTED_AREA",
    );
    expect(protectedHint?.severity).toBe("recommendation");
    expect(protectedHint?.message).toMatch(/sanft und schmerzfrei/);
    expect(protectedHint?.message).toMatch(/Schultern/);
    expect(protectedHint?.session_id).toBe(
      mobilityOf(version, "Morgenroutine").session_id,
    );
    // Knee and elbow have no mobility area: nothing is said about them.
    expect(
      mobilityValidationIssues(version, data, {
        protectedAreas: ["knee", "elbow"],
      }).map((i) => i.code),
    ).not.toContain("MOBILITY_PROTECTED_AREA");
    // Neck, lower back, hip and wrist map as well.
    for (const area of ["neck", "lower_back", "hip", "wrist"] as const) {
      const touched = mobilityValidationIssues(version, data, {
        protectedAreas: [area],
      }).some((i) => i.code === "MOBILITY_PROTECTED_AREA");
      // The exercises of this routine cover neck, shoulders, upper back only.
      expect(touched).toBe(area === "neck");
    }
  });
});

describe("comparison and change rows", () => {
  it("shows mobility sessions as added, changed, moved and removed", async () => {
    const h = harness();
    const base = await newDraft(h);
    const added = await edit(h, base, morning(), mobSession());
    const comparison = await h.plans.compare({
      from_plan_version_id: "pfx-v2",
      to_plan_version_id: added.plan_version_id,
    });
    const labels = comparison.changes.map((c) => c.label);
    expect(
      labels.some((l) =>
        /^Morgenroutine "Morgenroutine" hinzugefügt \(10 Min\., 5 Übungen\)/.test(
          l,
        ),
      ),
    ).toBe(true);
    expect(
      labels.some((l) =>
        /^Mobility-Einheit "Beweglichkeit" hinzugefügt/.test(l),
      ),
    ).toBe(true);
    expect(comparison.summary.sessions_added).toBe(2);

    const rows = planChangeRows(comparison.changes);
    expect(rows.map((r) => r.label)).toEqual(
      expect.arrayContaining(["Neue Morgenroutine", "Neue Mobility-Einheit"]),
    );
    expect(rows.find((r) => r.label === "Neue Morgenroutine")).toMatchObject({
      before: "nicht dabei",
      after: "Morgenroutine",
    });

    // A later draft: length, days, exercises, name and removal.
    h.advance();
    const clone = (
      await h.ok("create_plan_version", {
        request_id: "cmp-clone",
        source_plan_version_id: added.plan_version_id,
      })
    ).plan!.version;
    const changed = await edit(
      h,
      clone,
      {
        type: "update_mobility_session",
        session_id: mobilityOf(clone, "Morgenroutine").session_id,
        minutes: 15,
        exercise_ids: M.slice(0, 6),
        weekdays: [2],
        session_name: "Früh",
      },
      {
        type: "update_mobility_session",
        session_id: mobilityOf(clone, "Beweglichkeit").session_id,
        placement: "after_strength",
        after_session_id: "pfx-s-push",
      },
    );
    const next = await h.plans.compare({
      from_plan_version_id: added.plan_version_id,
      to_plan_version_id: changed.plan_version_id,
    });
    const text = next.changes.map((c) => c.label).join("\n");
    expect(text).toMatch(/Morgenroutine umbenannt: "Morgenroutine" → "Früh"/);
    expect(text).toMatch(/Dauer 10 Min\. → 15 Min\./);
    expect(text).toMatch(/Tage Mo, Mi, Fr → Di/);
    expect(text).toMatch(
      /Übungen geändert \(10 Min\., 5 Übungen → 15 Min\., 6 Übungen\)/,
    );
    expect(text).toMatch(/Platz Sa → nach "Push"/);
    const nextRows = planChangeRows(next.changes);
    expect(nextRows.some((r) => r.label === "Morgenroutine umbenannt")).toBe(
      true,
    );
    expect(nextRows.some((r) => /· Dauer$/.test(r.label))).toBe(true);

    h.advance();
    const last = (
      await h.ok("create_plan_version", {
        request_id: "cmp-clone-2",
        source_plan_version_id: changed.plan_version_id,
      })
    ).plan!.version;
    const gone = await edit(h, last, {
      type: "remove_mobility_session",
      session_id: mobilityOf(last, "Früh").session_id,
    });
    const removal = await h.plans.compare({
      from_plan_version_id: changed.plan_version_id,
      to_plan_version_id: gone.plan_version_id,
    });
    expect(removal.changes.map((c) => c.label)).toEqual([
      'Morgenroutine "Früh" entfernt',
    ]);
    expect(
      planChangeRows(removal.changes).map((r) => [r.label, r.after]),
    ).toEqual([["Morgenroutine", "entfällt"]]);
  });

  it("reports no change for an unchanged mobility session", async () => {
    const h = harness();
    const added = await edit(h, await newDraft(h), morning());
    const clone = (
      await h.ok("create_plan_version", {
        request_id: "same",
        source_plan_version_id: added.plan_version_id,
      })
    ).plan!.version;
    const comparison = await h.plans.compare({
      from_plan_version_id: added.plan_version_id,
      to_plan_version_id: clone.plan_version_id,
    });
    expect(comparison.changes).toEqual([]);
  });
});

describe("a plan without mobility", () => {
  it("is projected without the field, as before", async () => {
    const h = harness();
    const active = (await h.plans.context({})).plan!;
    expect("mobility_sessions" in active).toBe(false);
    const draft = await newDraft(h);
    expect("mobility_sessions" in draft).toBe(false);
    const withIt = await edit(h, draft, morning());
    expect("mobility_sessions" in withIt).toBe(true);
    const context = await h.plans.context({
      plan_version_id: draft.plan_version_id,
    });
    expect(context.plan!.mobility_sessions).toHaveLength(1);
  });
});

describe("the adjustment for a while", () => {
  it("leaves mobility as it is", async () => {
    const h = harness("active_ppl", { now: "2026-11-17T09:00:00Z" });
    const version = await edit(
      h,
      await newDraft(h),
      morning(),
      mobSession({ weekdays: [6] }),
    );
    h.advance();
    await activate(h, version);
    const before = canonical(await mobilityRows(h, version.plan_version_id));

    const response = PlanAdjustmentWriteResponseSchema.parse(
      await h.plans.adjustments.execute("create_plan_adjustment", {
        request_id: "adj-m1",
        timezone: "Europe/Berlin",
        kind: "week",
        sessions_per_week: 2,
        minutes_per_session: 30,
      }),
    );
    expect(response.error).toBeNull();
    const view = response.result!.plan_adjustment;
    // No mobility line in the changes the user is asked to confirm.
    expect(
      view.changes.filter((c) =>
        /Morgenroutine|Mobility-Einheit/.test(c.label),
      ),
    ).toEqual([]);
    const confirmed = PlanAdjustmentWriteResponseSchema.parse(
      await h.plans.adjustments.execute("confirm_plan_adjustment", {
        request_id: "adj-m2",
        plan_adjustment_id: view.adjustment.plan_adjustment_id,
        expected_row_revision: view.adjustment.row_revision,
      }),
    );
    expect(confirmed.error).toBeNull();
    // The temporary version has no mobility rows; the active ones are untouched.
    const data = await h.dataset();
    const temporary = view.adjustment.plan_version_id;
    expect(
      (data.planMobilitySessions ?? []).filter(
        (r) => r.plan_version_id === temporary,
      ),
    ).toEqual([]);
    expect(canonical(await mobilityRows(h, version.plan_version_id))).toBe(
      before,
    );
  });
});

describe("the audit trail", () => {
  it("records created, updated and removed without names or routines", async () => {
    const h = harness();
    const audit = h.store.audit as InMemoryAuditLog;
    const secret = "Geheimer-Name-4711";
    const added = await edit(
      h,
      await newDraft(h),
      morning({ session_name: secret }),
    );
    const id = mobilityOf(added, secret).session_id;
    const updated = await edit(h, added, {
      type: "update_mobility_session",
      session_id: id,
      session_name: "Anderer-Geheimname",
      minutes: 15,
      exercise_ids: M.slice(0, 6),
    });
    await edit(h, updated, {
      type: "remove_mobility_session",
      session_id: id,
    });
    const events = [...audit.events.values()].filter((e) =>
      e.event_type.startsWith("MOBILITY_SESSION_"),
    );
    expect(events.map((e) => e.event_type).sort()).toEqual([
      "MOBILITY_SESSION_CREATED",
      "MOBILITY_SESSION_REMOVED",
      "MOBILITY_SESSION_UPDATED",
    ]);
    const created = events.find(
      (e) => e.event_type === "MOBILITY_SESSION_CREATED",
    )!;
    expect(created.entity_id).toBe(id);
    expect(created.changes).toMatchObject({
      kind: { after: "morning" },
      minutes: { after: 10 },
      exercises: { after: 5 },
      status: { after: "active" },
    });
    const changed = events.find(
      (e) => e.event_type === "MOBILITY_SESSION_UPDATED",
    )!;
    expect(changed.changed_fields.sort()).toEqual(
      ["exercises", "minutes", "session_name"].sort(),
    );
    // No free text anywhere in the audit log of this plan.
    expect(JSON.stringify([...audit.events.values()])).not.toMatch(
      /Geheimer-Name|Anderer-Geheimname/,
    );
  });

  it("records a copy of a version as one logical event", async () => {
    const h = harness();
    const audit = h.store.audit as InMemoryAuditLog;
    const added = await edit(h, await newDraft(h), morning());
    const before = [...audit.events.values()].filter((e) =>
      e.event_type.startsWith("MOBILITY_SESSION_"),
    ).length;
    await h.ok("create_plan_version", {
      request_id: "copy-audit",
      source_plan_version_id: added.plan_version_id,
    });
    const after = [...audit.events.values()].filter((e) =>
      e.event_type.startsWith("MOBILITY_SESSION_"),
    ).length;
    expect(after).toBe(before);
  });
});

describe("the mobility catalog for the editor", () => {
  it("has the choice data and no cue texts", () => {
    const rows = mobilityCatalogRows();
    expect(rows).toHaveLength(40);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "areas",
          "default_s",
          "id",
          "max_s",
          "min_s",
          "mode",
          "name_de",
          "needs_mat",
          "per_side",
          "position",
        ].sort(),
      );
    }
    expect(rows.filter((r) => !r.needs_mat)).toHaveLength(20);
    const text = mobilityCatalogText();
    expect(text).toMatch(/^Mobility-Katalog \(Version mob-1;/);
    expect(text.split("\n")).toHaveLength(41);
    expect(text).toMatch(/mob_neck_rolls \| Nackenkreisen \|/);
    expect(text).not.toMatch(/cue/);
  });
});
