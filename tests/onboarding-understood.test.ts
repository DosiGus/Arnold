/**
 * "Das habe ich verstanden": the server names the gaps (progress.missing_fields),
 * the card only maps stored values to rows and never guesses a missing one.
 */
import { describe, expect, it } from "vitest";
import { buildProgress } from "../src/server/onboarding/profile";
import {
  hasUnderstood,
  understoodRows,
} from "../src/ui/components/onboarding/understood-step";
import type { OnboardingProfile } from "../src/shared/onboarding-contract";

const base = (
  path: OnboardingProfile["path"],
  training: Partial<OnboardingProfile["training"]> = {},
): OnboardingProfile => ({
  path,
  person: {},
  training: {
    primary_goal: null,
    experience: null,
    days_per_week: null,
    session_minutes: null,
    environment: null,
    ...training,
  },
  revision: 1,
  updated_at_utc: null,
});

const gaps = (profile: OnboardingProfile) => {
  const progress = buildProgress(profile, {
    step: "profile",
    can_request_plan: false,
    can_confirm_plan: false,
  });
  return understoodRows(profile, progress.missing_fields, () => {})
    .filter((row) => row.value === undefined)
    .map((row) => row.key);
};

describe("understood card", () => {
  it("is shown only for the Arnold path with at least one stored answer", () => {
    expect(hasUnderstood(base(null))).toBe(false);
    expect(hasUnderstood(base("arnold_plan"))).toBe(false);
    expect(hasUnderstood(base("own_plan", { primary_goal: "strength" }))).toBe(
      false,
    );
    expect(
      hasUnderstood(base("arnold_plan", { primary_goal: "strength" })),
    ).toBe(true);
  });

  it("marks exactly the fields the server lists as missing", () => {
    expect(
      gaps(base("arnold_plan", { primary_goal: "strength", days_per_week: 3 })),
    ).toEqual(["experience", "scope", "place"]);
    expect(
      gaps(
        base("arnold_plan", {
          primary_goal: "muscle_gain",
          experience: "beginner",
          days_per_week: 3,
          session_minutes: 60,
        }),
      ),
    ).toEqual(["place"]);
  });

  it("has no gaps for a complete profile; optional days never count as a gap", () => {
    const complete = base("arnold_plan", {
      primary_goal: "muscle_gain",
      experience: "beginner",
      days_per_week: 3,
      session_minutes: 60,
      environment: "gym",
    });
    expect(gaps(complete)).toEqual([]);
    const rows = understoodRows(complete, [], () => {});
    expect(rows.find((row) => row.key === "days")?.value).toBe("frei wählbar");
  });

  it("asks for the run answers only with a running goal, and unknown stays unknown", () => {
    const running = base("arnold_plan", {
      primary_goal: "endurance_running",
      experience: "beginner",
      days_per_week: 3,
      session_minutes: 60,
      environment: "outdoor",
    });
    expect(gaps(running)).toEqual(["run"]);
    expect(
      understoodRows(running, [], () => []).find((row) => row.key === "scope")
        ?.value,
    ).toBe("3 Tage · 60 Min.");
  });
});
