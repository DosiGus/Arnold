import { describe, expect, it } from "vitest";
import { validateProposalAgainstProfile } from "../src/server/onboarding/profile";
import {
  ONBOARDING_VALIDATION_CODES,
  OnboardingValidationCodeSchema,
  type OnboardingProfile,
} from "../src/shared/onboarding-contract";

/**
 * UX-012: three rules of a proposal against the profile, no real data.
 * Avoided exercise = refusal; missing equipment and too many exercises for the
 * time = hints. What the profile does not say is never assumed.
 */
const profile = (
  training: Record<string, unknown> = {},
  path: "arnold_plan" | "own_plan" = "arnold_plan",
) =>
  ({
    path,
    person: {},
    training: {
      primary_goal: "muscle_gain",
      experience: "intermediate",
      days_per_week: 1,
      session_minutes: 60,
      environment: "gym",
      ...training,
    },
    revision: 1,
    updated_at_utc: "2026-05-01T10:00:00Z",
  }) as unknown as OnboardingProfile;

const day = (...ids: string[]) => [
  {
    session_name: "Tag",
    exercises: ids.map((exercise_id) => ({ exercise_id })),
  },
];
const codes = (r: ReturnType<typeof validateProposalAgainstProfile>) => [
  ...r.errors.map((i) => i.code),
  ...r.warnings.map((i) => i.code),
];

describe("contract codes", () => {
  it("only adds codes: every earlier one is still there", () => {
    for (const code of [
      "MISSING_PATH",
      "PREFERRED_EXERCISE_UNAVAILABLE",
      "PROPOSAL_DAYS_MISMATCH",
      "PROPOSAL_EMPTY_SESSION",
    ])
      expect(ONBOARDING_VALIDATION_CODES).toContain(code);
    for (const code of [
      "PROPOSAL_AVOIDED_EXERCISE",
      "PROPOSAL_EQUIPMENT_MISSING",
      "PROPOSAL_OVER_TIME_BUDGET",
    ])
      expect(OnboardingValidationCodeSchema.safeParse(code).success).toBe(true);
  });
});

describe("avoided exercise (refusal)", () => {
  const p = profile({ avoided_exercise_ids: ["deadlift", "lunge"] });

  it("refuses a plan with an avoided exercise, in plain words", () => {
    const r = validateProposalAgainstProfile(p, day("squat", "deadlift"));
    expect(r.valid).toBe(false);
    expect(r.errors[0].code).toBe("PROPOSAL_AVOIDED_EXERCISE");
    expect(r.errors[0].message).toContain("Kreuzheben");
    expect(r.errors[0].message).not.toMatch(/PROPOSAL_|deadlift/);
  });

  it("names several avoided exercises together", () => {
    const r = validateProposalAgainstProfile(p, day("deadlift", "lunge"));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toContain("und");
  });

  it("takes a plan without them", () => {
    expect(
      validateProposalAgainstProfile(p, day("squat", "leg-press")).valid,
    ).toBe(true);
  });

  it("does nothing when the profile avoids nothing, and not for an own plan", () => {
    expect(
      validateProposalAgainstProfile(profile(), day("deadlift")).valid,
    ).toBe(true);
    expect(
      validateProposalAgainstProfile(
        profile({ avoided_exercise_ids: ["deadlift"] }, "own_plan"),
        day("deadlift"),
      ).valid,
    ).toBe(true);
  });
});

describe("missing equipment (hint)", () => {
  const home = profile({ environment: "home", equipment: ["dumbbells"] });

  it("warns, never refuses", () => {
    const r = validateProposalAgainstProfile(home, day("leg-press"));
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual([
      "PROPOSAL_EQUIPMENT_MISSING",
    ]);
    expect(r.warnings[0].message).toContain("Beinpresse");
  });

  it("is silent for what the person can do", () => {
    expect(
      codes(
        validateProposalAgainstProfile(home, day("push-up", "goblet-squat")),
      ),
    ).toEqual([]);
  });

  it("is silent in a gym and for mixed", () => {
    for (const environment of ["gym", "mixed"])
      expect(
        codes(
          validateProposalAgainstProfile(
            profile({ environment }),
            day("leg-press", "bench-press"),
          ),
        ),
      ).toEqual([]);
  });

  it("assumes nothing when the answer is unknown", () => {
    // no equipment listed at home, no place at all, own exercises
    for (const t of [
      { environment: "home" },
      { environment: null },
      { environment: "outdoor" },
    ])
      expect(
        codes(validateProposalAgainstProfile(profile(t), day("leg-press"))),
      ).toEqual([]);
    expect(
      codes(validateProposalAgainstProfile(home, day("custom:1"))),
    ).toEqual([]);
  });
});

describe("time budget (hint)", () => {
  const ids = (n: number) =>
    [
      "squat",
      "bench-press",
      "lat-pulldown",
      "leg-curl",
      "lateral-raise",
      "crunch",
      "face-pull",
      "dumbbell-curl",
      "lunge",
      "dips",
      "pull-up",
    ].slice(0, n);

  it("warns above the limit of the planning rules and names the minutes", () => {
    const r = validateProposalAgainstProfile(
      profile({ session_minutes: 30 }),
      day(...ids(4)),
    );
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual([
      "PROPOSAL_OVER_TIME_BUDGET",
    ]);
    expect(r.warnings[0].message).toContain("30 Minuten");
    expect(r.warnings[0].message).toContain("höchstens 3");
  });

  it.each([
    [30, 3],
    [45, 5],
    [60, 7],
    [75, 9],
    [90, 10],
  ])("%i minutes hold %i exercises, one more is a hint", (minutes, max) => {
    const p = profile({ session_minutes: minutes });
    expect(codes(validateProposalAgainstProfile(p, day(...ids(max))))).toEqual(
      [],
    );
    expect(
      codes(validateProposalAgainstProfile(p, day(...ids(max + 1)))),
    ).toEqual(["PROPOSAL_OVER_TIME_BUDGET"]);
  });

  it("gives one message for several sessions", () => {
    const long = ids(4).map((id) => id);
    const r = validateProposalAgainstProfile(
      profile({ session_minutes: 30, days_per_week: 2 }),
      [
        {
          session_name: "A",
          exercises: long.map((exercise_id) => ({ exercise_id })),
        },
        {
          session_name: "B",
          exercises: long.map((exercise_id) => ({ exercise_id })),
        },
      ],
    );
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toContain('"A"');
    expect(r.warnings[0].message).toContain('"B"');
  });

  it("assumes nothing when the length is unknown", () => {
    expect(
      codes(
        validateProposalAgainstProfile(
          profile({ session_minutes: null }),
          day(...ids(11)),
        ),
      ),
    ).toEqual([]);
  });
});
