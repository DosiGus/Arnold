import { describe, expect, it } from "vitest";
import { draft, harness, names, session } from "./fixtures/arnold-plan";
import { PLAN_TRANSITIONS, canTransition } from "../src/server/plan/domain";

/**
 * Plan creation and the lifecycle state machine.
 *
 * The central claim under test is that Arnold imposes no split: the same code
 * path must accept one recurring session, five custom ones, and names that have
 * nothing to do with Push/Pull/Legs.
 */
describe("creating a training plan", () => {
  it("creates a draft, never an active plan", async () => {
    const h = harness("empty");
    const result = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Mein erster Plan",
      sessions: [session("Ganzkörper A")],
    });
    const version = result.plan!.version;
    expect(version.status).toBe("draft");
    expect(version.version_no).toBe(1);
    expect(version.activated_at_utc).toBeNull();
    expect(version.editable).toBe(true);
    // No activation happened as a side effect of creation.
    expect((await h.dataset()).plans.some((p) => p.status === "active")).toBe(
      false,
    );
  });

  it.each([
    ["Ganzkörper", ["Ganzkörper A", "Ganzkörper B", "Ganzkörper C"]],
    ["Push/Pull/Legs", ["Push", "Pull", "Legs"]],
    [
      "Oberkörper/Unterkörper",
      ["Oberkörper A", "Unterkörper A", "Oberkörper B", "Unterkörper B"],
    ],
    [
      "individuell",
      ["Brust + Rücken", "Arme + Schultern", "Beine", "Kondition + Core"],
    ],
    ["ein wiederkehrender Typ", ["Training A"]],
    ["fünf Einheiten", ["A", "B", "C", "D", "E"]],
  ])("supports an arbitrary split: %s", async (_label, sessionNames) => {
    const h = harness("empty");
    const version = await draft(
      h,
      sessionNames.map((name) => session(name)),
      { days_per_week: Math.min(sessionNames.length, 7) },
    );
    expect(names(version)).toEqual(sessionNames);
    expect(version.session_count).toBe(sessionNames.length);
    // Session order is explicit, contiguous and in the order supplied.
    expect(version.sessions.map((s) => s.session_order)).toEqual(
      sessionNames.map((_, index) => index + 1),
    );
  });

  it("stores the exercise order explicitly", async () => {
    const h = harness("empty");
    const version = await draft(h, [
      session("Push", ["plan-fx-bench", "plan-fx-incline", "plan-fx-lateral"]),
    ]);
    expect(
      version.sessions[0].exercises.map((e) => [
        e.exercise_id,
        e.exercise_order,
      ]),
    ).toEqual([
      ["plan-fx-bench", 1],
      ["plan-fx-incline", 2],
      ["plan-fx-lateral", 3],
    ]);
  });

  it("takes execution and load convention from the catalog", async () => {
    const h = harness("empty");
    const version = await draft(h, [
      session("Pull", ["plan-fx-row", "plan-fx-pullup", "plan-fx-curl"]),
    ]);
    const byId = Object.fromEntries(
      version.sessions[0].exercises.map((e) => [e.exercise_id, e]),
    );
    expect(byId["plan-fx-row"].target_execution_mode).toBe("unilateral");
    expect(byId["plan-fx-row"].target_implement_count).toBe(1);
    expect(byId["plan-fx-pullup"].target_load_basis).toBe("bodyweight_only");
    expect(byId["plan-fx-curl"].target_execution_mode).toBe("alternating");
    expect(byId["plan-fx-curl"].target_implement_count).toBe(2);
  });

  it("does not invent a training prescription", async () => {
    const h = harness("empty");
    const result = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Ohne Zielwerte",
      sessions: [
        { session_name: "A", exercises: [{ exercise_id: "plan-fx-bench" }] },
      ],
    });
    const exercise = result.plan!.version.sessions[0].exercises[0];
    expect(exercise.target_sets).toBeNull();
    expect(exercise.rep_min).toBeNull();
    expect(exercise.target_load_kg).toBeNull();
    // It is saved as a draft and reported as not yet usable for adherence.
    expect(result.validation!.valid).toBe(true);
    expect(result.validation!.warnings.map((w) => w.code)).toContain(
      "MISSING_TARGET_SETS",
    );
  });

  it("rejects an unknown exercise reference", async () => {
    const h = harness("empty");
    const error = await h.fails("create_training_plan", {
      request_id: "r1",
      name: "Kaputt",
      sessions: [session("A", ["does-not-exist"])],
    });
    expect(error.code).toBe("EXERCISE_NOT_FOUND");
    expect((await h.dataset()).plans).toHaveLength(0);
  });

  it("rejects a plan with no session at all", async () => {
    const h = harness("empty");
    const error = await h.fails("create_training_plan", {
      request_id: "r1",
      name: "Leer",
      sessions: [],
    });
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a session without exercises, because it cannot be stored", async () => {
    const h = harness("empty");
    const error = await h.fails("create_training_plan", {
      request_id: "r1",
      name: "Leere Einheit",
      sessions: [{ session_name: "Leer", exercises: [] }],
    });
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects two sessions with the same name", async () => {
    const h = harness("empty");
    const error = await h.fails("create_training_plan", {
      request_id: "r1",
      name: "Doppelt",
      sessions: [session("Push"), session("push ")],
    });
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("continues an existing plan family when asked", async () => {
    const h = harness();
    const result = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Dritte Fassung",
      plan_family_id: "pfx-family-ppl",
      sessions: [session("Push")],
    });
    expect(result.plan!.version.plan_family_id).toBe("pfx-family-ppl");
    expect(result.plan!.version.version_no).toBe(3);
  });

  it("starts a new family by default, so a second routine is independent", async () => {
    const h = harness();
    const result = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Oberkörper/Unterkörper",
      sessions: [session("Oberkörper A"), session("Unterkörper A")],
    });
    expect(result.plan!.version.plan_family_id).not.toBe("pfx-family-ppl");
    expect(result.plan!.version.version_no).toBe(1);
    // The existing active plan is untouched.
    const data = await h.dataset();
    expect(data.plans.find((p) => p.plan_version_id === "pfx-v2")!.status).toBe(
      "active",
    );
  });

  it("marks an AI proposal as needing confirmation", async () => {
    const h = harness("empty");
    const result = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "KI-Vorschlag",
      origin: "ai_proposal",
      sessions: [session("A")],
    });
    expect(result.plan!.version.status).toBe("draft");
    expect(result.warnings.join(" ")).toMatch(
      /erst nach ausdrücklicher Bestätigung/,
    );
  });

  it("rejects an unknown plan family", async () => {
    const h = harness("empty");
    const error = await h.fails("create_training_plan", {
      request_id: "r1",
      name: "X",
      plan_family_id: "no-such-family",
      sessions: [session("A")],
    });
    expect(error.code).toBe("PLAN_NOT_FOUND");
  });
});

describe("the plan lifecycle state machine", () => {
  it("allows exactly the three documented transitions", () => {
    expect(PLAN_TRANSITIONS).toEqual({
      draft: ["active", "archived"],
      active: ["archived"],
      archived: [],
    });
  });

  it("never leads back into draft", () => {
    for (const from of ["draft", "active", "archived"] as const)
      expect(canTransition(from, "draft")).toBe(false);
  });

  it("does not allow reactivating an archived version", () => {
    expect(canTransition("archived", "active")).toBe(false);
  });
});
