/**
 * B11: "Eigenen Plan übernehmen" keeps exercises that are not in the catalog.
 * They are created as the user's own exercises in the same write as the plan
 * draft, instead of being dropped into open_questions.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { harness, session } from "./fixtures/arnold-plan";

const rid = () => randomUUID();

async function ownPlanSetup() {
  const runtime = createFixtureOnboarding();
  const started = await runtime.onboarding.startOnboarding({
    request_id: rid(),
  });
  const claim = {
    onboarding_session_id: started.state!.session.onboarding_session_id,
    session_token: started.session_token!,
  };
  const chosen = await runtime.onboarding.updateProfile({
    request_id: rid(),
    ...claim,
    profile: { path: "own_plan" },
  });
  expect(chosen.ok).toBe(true);
  const brief = await runtime.onboarding.getBrief(claim);
  return { runtime, claim, catalogId: brief.exercise_catalog[0].exercise_id };
}

const OWN = [
  { key: "custom:1", name_de: "Landmine Press kniend" },
  {
    key: "custom:2",
    name_de: "Copenhagen Plank",
    default_load_basis: "bodyweight_only" as const,
  },
  {
    key: "custom:3",
    name_de: "Zercher-Kniebeuge",
    equipment: "Langhantel",
    primary_muscle: "Beine",
  },
];

describe("own plan with three unknown exercises", () => {
  it("creates them as own exercises and assigns them to the draft", async () => {
    const { runtime, claim, catalogId } = await ownPlanSetup();
    const before = (await runtime.store.read()).exercises.length;
    const submitted = await runtime.onboarding.submitPlanProposal({
      request_id: rid(),
      ...claim,
      name: "Mein eigener Plan",
      origin: "existing_routine",
      custom_exercises: OWN,
      sessions: [
        {
          session_name: "Tag A",
          exercises: [
            { exercise_id: catalogId, target_sets: 3 },
            {
              exercise_id: "custom:1",
              target_sets: 3,
              rep_min: 8,
              rep_max: 10,
            },
          ],
        },
        {
          session_name: "Tag B",
          exercises: [
            { exercise_id: "custom:2", target_sets: 3 },
            { exercise_id: "custom:3", target_sets: 4, rep_min: 5, rep_max: 5 },
          ],
        },
      ],
    });
    expect(submitted.ok, JSON.stringify(submitted.error)).toBe(true);
    expect(submitted.state!.plan!.exercise_count).toBe(4);

    const data = await runtime.store.read();
    expect(data.exercises.length).toBe(before + 3);
    const own = new Map(
      data.exercises
        .filter((e) => OWN.some((o) => o.name_de === e.name_de))
        .map((e) => [e.name_de, e]),
    );
    expect([...own.keys()].sort()).toEqual(OWN.map((o) => o.name_de).sort());
    expect(own.get("Copenhagen Plank")!.default_load_basis).toBe(
      "bodyweight_only",
    );
    expect(own.get("Zercher-Kniebeuge")!).toMatchObject({
      equipment: "Langhantel",
      primary_muscle: "Beine",
      variant_key: "eigene",
      status: "active",
    });
    // No placeholder key is stored anywhere.
    expect(JSON.stringify(data)).not.toContain("custom:");

    const planId =
      submitted.state!.session.plan_draft_reference!.plan_version_id;
    const items = data.planItems.filter((i) => i.plan_version_id === planId);
    for (const exercise of own.values())
      expect(
        items.some((item) => item.exercise_id === exercise.exercise_id),
        exercise.name_de,
      ).toBe(true);
  });

  it("refuses a session that uses an undescribed key, without writing", async () => {
    const { runtime, claim } = await ownPlanSetup();
    const before = await runtime.store.read();
    const refused = await runtime.onboarding.submitPlanProposal({
      request_id: rid(),
      ...claim,
      name: "Unvollständig",
      origin: "existing_routine",
      custom_exercises: [OWN[0]],
      sessions: [
        {
          session_name: "Tag A",
          exercises: [{ exercise_id: "custom:1" }, { exercise_id: "custom:9" }],
        },
      ],
    });
    expect(refused.ok).toBe(false);
    expect(refused.error!.details.join(" ")).toContain("custom:9");
    expect(await runtime.store.read()).toEqual(before);
  });

  it("tells ChatGPT to describe unknown exercises instead of dropping them", async () => {
    const { runtime, claim } = await ownPlanSetup();
    const brief = await runtime.onboarding.getBrief(claim);
    const rules = brief.constraints.join(" ");
    expect(rules).toContain("custom_exercises");
    expect(rules).not.toContain("sie weglassen und in open_questions nennen");
  });
});

describe("plan service: own exercises", () => {
  it("reuses an existing exercise with the same name instead of a duplicate", async () => {
    const h = harness();
    const existing = (await h.dataset()).exercises[0];
    const before = (await h.dataset()).exercises.length;
    const result = await h.ok("create_training_plan", {
      request_id: "own-reuse",
      name: "Wiederverwendung",
      custom_exercises: [
        { key: "custom:a", name_de: existing.name_de.toUpperCase() },
        { key: "custom:b", name_de: "Völlig Neue Übung" },
      ],
      sessions: [session("A", ["custom:a", "custom:b"])],
    });
    const after = await h.dataset();
    expect(after.exercises.length).toBe(before + 1);
    expect(
      result.plan!.version.sessions[0].exercises.map((e) => e.exercise_id),
    ).toContain(existing.exercise_id);
    expect(result.warnings.join(" ")).toContain("1 eigene Übung");
  });

  it("creates the exercise and the plan in one replayable write", async () => {
    const h = harness();
    const input = {
      request_id: "own-replay",
      name: "Einmal",
      custom_exercises: [{ key: "custom:x", name_de: "Einmalige Übung" }],
      sessions: [session("A", ["custom:x"])],
    };
    await h.ok("create_training_plan", input);
    const replay = await h.write("create_training_plan", input);
    expect(replay.replayed).toBe(true);
    expect(
      (await h.dataset()).exercises.filter(
        (e) => e.name_de === "Einmalige Übung",
      ),
    ).toHaveLength(1);
  });

  it("refuses contradicting defaults", async () => {
    const h = harness();
    const error = await h.fails("create_training_plan", {
      request_id: "own-bad",
      name: "Widerspruch",
      custom_exercises: [
        {
          key: "custom:u",
          name_de: "Einarmiges Rudern Spezial",
          default_execution_mode: "unilateral",
          default_implement_count: 2,
        },
      ],
      sessions: [session("A", ["custom:u"])],
    });
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});
