/**
 * RDS-017 (D-07): the mat answer during the setup. Synthetic data only.
 *
 * Before the setup is finished no mobility profile is stored, so the plan
 * service takes has_mat from the caller's open setup. The stored profile
 * takes precedence; a finished, cancelled or foreign setup and a missing
 * answer mean unknown: no floor exercises in the morning, nothing written.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FixtureOnboardingAccessControl } from "../src/server/onboarding/access";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { InMemoryOnboardingRepository } from "../src/server/onboarding/repository";
import type { OnboardingProfilePatch } from "../src/shared/onboarding-contract";

const rid = () => `mat-${randomUUID().slice(0, 12)}`;

const STANDING = [
  "mob_neck_rolls",
  "mob_neck_side",
  "mob_shoulder_circles",
  "mob_arm_circles",
  "mob_doorway_chest",
];
const WITH_FLOOR = ["mob_cat_cow", "mob_childs_pose", ...STANDING.slice(0, 3)];

const morning = (exercise_ids: string[]) => ({
  type: "add_mobility_session",
  kind: "morning",
  session_name: "Morgenroutine",
  minutes: 10,
  exercise_ids,
  weekdays: [1, 3, 5],
});

const TRAINING = {
  primary_goal: "muscle_gain",
  experience: "intermediate",
  days_per_week: 3,
  session_minutes: 60,
  environment: "gym",
  mobility: {
    wants: true,
    morning: { weekdays: ["mon", "wed", "fri"], minutes: 10 },
    sessions: null,
    stiff_areas: [],
  },
} as const;

type Fixture = ReturnType<typeof createFixtureOnboarding>;

/** An open setup with the given mat answer and the plan draft it proposed. */
async function setupDraft(fixture: Fixture, has_mat?: boolean) {
  const service = fixture.onboarding;
  const profile: OnboardingProfilePatch = {
    path: "arnold_plan",
    training: {
      ...TRAINING,
      ...(has_mat === undefined ? {} : { has_mat }),
    },
  };
  await service.startOnboarding({ request_id: rid() });
  const saved = await service.updateProfile({ request_id: rid(), profile });
  expect(saved.ok, saved.error?.message).toBe(true);
  const brief = await service.getBrief({});
  const submitted = await service.submitPlanProposal({
    request_id: rid(),
    name: "Mein Plan",
    origin: "ai_proposal",
    sessions: brief.exercise_catalog.slice(0, 3).map((e, i) => ({
      session_name: `Einheit ${i + 1}`,
      exercises: [
        { exercise_id: e.exercise_id, target_sets: 3, rep_min: 8, rep_max: 12 },
      ],
    })),
  });
  expect(submitted.ok, submitted.error?.message).toBe(true);
  return submitted.state!.plan!;
}

const editDraft = (
  fixture: Fixture,
  draft: { plan_version_id: string; row_revision: number },
  edit: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  fixture.plans.updatePlanDraft({
    request_id: rid(),
    plan_version_id: draft.plan_version_id,
    expected_row_revision: draft.row_revision,
    edits: [edit],
    ...extra,
  });

async function confirmAndFinish(
  fixture: Fixture,
  draft: { plan_version_id: string; row_revision: number },
) {
  const confirmed = await fixture.onboarding.confirmPlan({
    request_id: rid(),
    confirmation: {
      plan_version_id: draft.plan_version_id,
      row_revision: draft.row_revision,
      confirmed: true,
    },
  });
  expect(confirmed.ok, confirmed.error?.message).toBe(true);
  const done = await fixture.onboarding.finishSetup({ request_id: rid() });
  expect(done.ok, done.error?.message).toBe(true);
}

/** A new draft of the active plan, after the setup. */
async function draftOfActive(fixture: Fixture) {
  const active = (await fixture.store.read()).plans.find(
    (p) => p.status === "active",
  )!;
  const created = await fixture.plans.createPlanVersion({
    request_id: rid(),
    source_plan_version_id: active.plan_version_id,
  });
  expect(created.ok, created.error?.message).toBe(true);
  return created.result!.plan!.version;
}

describe("the mat answer of the open setup (RDS-017)", () => {
  it("lets floor exercises into the morning of the setup draft with has_mat true", async () => {
    const fixture = createFixtureOnboarding();
    const draft = await setupDraft(fixture, true);
    expect((await fixture.store.read()).mobilityProfiles).toBeUndefined();
    const edited = await editDraft(fixture, draft, morning(WITH_FLOOR));
    expect(edited.ok, edited.error?.message).toBe(true);
    const routine = edited.result!.plan!.version.mobility_sessions!.find(
      (s) => s.kind === "morning",
    )!;
    expect(routine.template.exercise_ids).toEqual(WITH_FLOOR);
    // Reading the setup wrote nothing: still no stored profile.
    expect((await fixture.store.read()).mobilityProfiles).toBeUndefined();
  });

  for (const has_mat of [false, undefined]) {
    it(`refuses floor exercises with has_mat ${String(has_mat)}, standing ones still work`, async () => {
      const fixture = createFixtureOnboarding();
      const draft = await setupDraft(fixture, has_mat);
      const refused = await editDraft(fixture, draft, morning(WITH_FLOOR));
      expect(refused.ok).toBe(false);
      expect(refused.error?.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(refused.error)).toMatch(/MOBILITY|Matte/);
      const standing = await editDraft(fixture, draft, morning(STANDING));
      expect(standing.ok, standing.error?.message).toBe(true);
      expect((await fixture.store.read()).mobilityProfiles).toBeUndefined();
    });
  }

  it("retimes an update with floor exercises from the setup answer", async () => {
    const fixture = createFixtureOnboarding();
    const draft = await setupDraft(fixture, true);
    const added = await editDraft(fixture, draft, morning(STANDING));
    expect(added.ok, added.error?.message).toBe(true);
    const version = added.result!.plan!.version;
    const updated = await editDraft(fixture, version, {
      type: "update_mobility_session",
      session_id: version.mobility_sessions![0]!.session_id,
      exercise_ids: WITH_FLOOR,
    });
    expect(updated.ok, updated.error?.message).toBe(true);
  });

  it("after the finish the stored profile decides, not the finished setup", async () => {
    const fixture = createFixtureOnboarding();
    const draft = await setupDraft(fixture, true);
    await confirmAndFinish(fixture, draft);
    expect((await fixture.store.read()).mobilityProfiles).toMatchObject([
      { has_mat: true },
    ]);
    const withMat = await editDraft(
      fixture,
      await draftOfActive(fixture),
      morning(WITH_FLOOR),
    );
    expect(withMat.ok, withMat.error?.message).toBe(true);

    // The user says no mat in the chat: the stored no wins over the setup's yes.
    const changed = await fixture.mobility.updateProfile(
      { request_id: rid(), preference: TRAINING.mobility, has_mat: false },
      undefined,
    );
    expect(changed.ok).toBe(true);
    const next = withMat.result!.plan!.version;
    const refused = await editDraft(fixture, next, {
      type: "update_mobility_session",
      session_id: next.mobility_sessions![0]!.session_id,
      exercise_ids: WITH_FLOOR.slice().reverse(),
    });
    expect(refused.error?.code).toBe("VALIDATION_ERROR");
  });

  it("ignores a cancelled setup", async () => {
    const fixture = createFixtureOnboarding();
    await setupDraft(fixture, true);
    const cancelled = await fixture.onboarding.cancelOnboarding({
      request_id: rid(),
    });
    expect(cancelled.ok).toBe(true);
    const created = await fixture.plans.createTrainingPlan({
      request_id: rid(),
      name: "Eigener Plan",
      days_per_week: 2,
      sessions: [
        {
          session_name: "A",
          exercises: [
            {
              exercise_id: (await fixture.store.read()).exercises[0]!
                .exercise_id,
              target_sets: 3,
              rep_min: 6,
              rep_max: 8,
            },
          ],
        },
      ],
    });
    expect(created.ok, created.error?.message).toBe(true);
    const refused = await editDraft(
      fixture,
      created.result!.plan!.version,
      morning(WITH_FLOOR),
    );
    expect(refused.error?.code).toBe("VALIDATION_ERROR");
  });

  it("never uses another person's setup, and a tool argument cannot set the mat", async () => {
    const repository = new InMemoryOnboardingRepository();
    const alice = createFixtureOnboarding({
      repository,
      access: new FixtureOnboardingAccessControl("alice"),
    });
    await setupDraft(alice, true);
    const bob = createFixtureOnboarding({
      repository,
      access: new FixtureOnboardingAccessControl("bob"),
    });
    expect(await bob.onboarding.openSetupHasMat(undefined)).toBeUndefined();
    expect(await alice.onboarding.openSetupHasMat(undefined)).toBe(true);
    const bobDraft = await setupDraft(bob, undefined);
    const refused = await editDraft(bob, bobDraft, morning(WITH_FLOOR));
    expect(refused.error?.code).toBe("VALIDATION_ERROR");

    // has_mat is no argument of update_plan_draft.
    const smuggled = await editDraft(bob, bobDraft, morning(WITH_FLOOR), {
      has_mat: true,
    });
    expect(smuggled.ok).toBe(false);
    expect(smuggled.error?.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(smuggled.error)).not.toMatch(/MOBILITY_/);
  });
});
