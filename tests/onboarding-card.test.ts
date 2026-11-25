import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { cardForState } from "../src/shared/onboarding-card";
import type {
  OnboardingState,
  OnboardingStatus,
} from "../src/shared/onboarding-contract";

/** RDS-011: which card the server state calls for (D-17). */

const started = await createFixtureOnboarding().onboarding.startOnboarding({
  request_id: randomUUID(),
});
const fresh = started.state as OnboardingState;

/** A state with the server's derived facts set directly, nothing recomputed. */
function stateWith(
  patch: {
    status?: OnboardingStatus;
    path?: "arnold_plan" | "own_plan" | null;
    person?: boolean;
    modules?: boolean;
    missing?: string[];
    required?: boolean;
    run?: { required: boolean; ready: boolean };
    plan?: boolean;
  } = {},
): OnboardingState {
  const state = structuredClone(fresh);
  state.session.status = patch.status ?? "COLLECTING_PROFILE";
  state.session.profile.path =
    patch.path === undefined ? "arnold_plan" : patch.path;
  state.progress.person_complete = patch.person ?? true;
  state.progress.missing_fields = (patch.missing ?? []) as never;
  state.open_questions = patch.required
    ? [{ id: "training.experience", kind: "required", ask: "?", fields: [] }]
    : [];
  state.run_setup = patch.run ?? { required: false, ready: true };
  if (patch.modules ?? true)
    state.session.profile.training.modules = {
      running: false,
      mobility: false,
      morning_routine: false,
    };
  else delete state.session.profile.training.modules;
  state.plan = patch.plan ? ({ name: "Plan" } as never) : null;
  return state;
}

describe("cardForState", () => {
  const table: [string, OnboardingState, string][] = [
    ["a fresh setup: basics missing", fresh, "person"],
    ["basics missing", stateWith({ person: false }), "person"],
    ["modules not chosen", stateWith({ modules: false }), "modules"],
    [
      "basics missing beat modules missing",
      stateWith({ person: false, modules: false }),
      "person",
    ],
    [
      "required fields missing",
      stateWith({ missing: ["training.environment"] }),
      "checklist",
    ],
    ["a required question is open", stateWith({ required: true }), "checklist"],
    [
      "run details required and not ready",
      stateWith({ run: { required: true, ready: false } }),
      "checklist",
    ],
    [
      "everything answered, no draft yet: not clear",
      stateWith({ status: "PROFILE_READY" }),
      "checklist",
    ],
    [
      "draft under review",
      stateWith({ status: "REVIEWING_PLAN", plan: true }),
      "plan",
    ],
    [
      "required fields beat an existing draft",
      stateWith({ status: "REVIEWING_PLAN", plan: true, required: true }),
      "checklist",
    ],
    [
      "plan confirmed",
      stateWith({ status: "PLAN_CONFIRMED", plan: true }),
      "wearable",
    ],
    [
      "ready to finish",
      stateWith({ status: "READY_TO_FINISH", plan: true }),
      "wearable",
    ],
    ["completed", stateWith({ status: "COMPLETED", plan: true }), "start"],
    [
      "completed wins even without basics",
      stateWith({ status: "COMPLETED", person: false, modules: false }),
      "start",
    ],
    ["own plan path (deferred)", stateWith({ path: "own_plan" }), "checklist"],
    ["cancelled", stateWith({ status: "CANCELLED" }), "checklist"],
    ["expired", stateWith({ status: "EXPIRED" }), "checklist"],
  ];

  it.each(table)("%s -> %s", (_name, state, card) => {
    expect(cardForState(state)).toBe(card);
  });

  it("never picks benchmarks or run_reference on its own", () => {
    for (const [, state] of table)
      expect(["benchmarks", "run_reference"]).not.toContain(
        cardForState(state),
      );
  });
});
