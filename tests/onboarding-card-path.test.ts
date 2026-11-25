import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { cardForState } from "../src/shared/onboarding-card";
import type { OnboardingState } from "../src/shared/onboarding-contract";
import { withPath } from "../src/ui/hooks/useOnboardingCard";

/** RDS-011 follow-up: without a welcome page the first card save sets the way. */

describe("withPath", () => {
  it("adds arnold_plan while no way is stored", () => {
    expect(withPath({ training: { modules: undefined } }, null)).toEqual({
      path: "arnold_plan",
      training: { modules: undefined },
    });
    expect(withPath({ person: { age_years: 30 } }, null).path).toBe(
      "arnold_plan",
    );
  });
  it("leaves a stored way and an explicit path alone", () => {
    const patch = { person: { age_years: 30 } };
    expect(withPath(patch, "arnold_plan")).toBe(patch);
    expect(withPath(patch, "own_plan")).toBe(patch);
    expect(withPath({ path: "own_plan" }, null).path).toBe("own_plan");
  });
});

describe("flow person -> modules -> required answers", () => {
  it("never stays on the checklist because of the way", async () => {
    const service = createFixtureOnboarding().onboarding;
    const started = await service.startOnboarding({ request_id: randomUUID() });
    let state = started.state as OnboardingState;
    expect(state.session.profile.path).toBeNull();
    expect(cardForState(state)).toBe("person");
    const write = async (patch: Parameters<typeof withPath>[0]) => {
      const r = await service.updateProfile({
        request_id: randomUUID(),
        profile: withPath(patch, state.session.profile.path),
      } as never);
      expect(r.ok, r.error?.message).toBe(true);
      state = r.state as OnboardingState;
    };
    await write({
      person: {
        age_years: 34,
        sex: "male",
        height_cm: 180,
        body_weight_kg: 80,
      },
    });
    expect(state.session.profile.path).toBe("arnold_plan");
    expect(state.progress.missing_fields).not.toContain("path");
    expect(cardForState(state)).toBe("modules");
    await write({
      training: {
        modules: { running: false, mobility: false, morning_routine: false },
      },
    });
    expect(cardForState(state)).toBe("checklist");
    expect(state.progress.missing_fields).not.toContain("path");
    await write({
      training: {
        primary_goal: "muscle_gain",
        experience: "intermediate",
        days_per_week: 4,
        session_minutes: 60,
        environment: "gym",
      },
    });
    expect(state.progress.missing_fields).toEqual([]);
    expect(state.open_questions.filter((q) => q.kind === "required")).toEqual(
      [],
    );
  });
});
