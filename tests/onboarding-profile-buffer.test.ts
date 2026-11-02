import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { OnboardingProfileBuffer } from "../src/ui/client/OnboardingProfileBuffer";
import type {
  OnboardingProfilePatch,
  OnboardingState,
} from "../src/shared/onboarding-contract";

beforeEach(() => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const runtime = createFixtureOnboarding();
  const started = await runtime.onboarding.startOnboarding({
    request_id: crypto.randomUUID(),
  });
  const claim = {
    onboarding_session_id: started.state!.session.onboarding_session_id,
    session_token: started.session_token!,
  };
  const chosen = await runtime.onboarding.updateProfile({
    ...claim,
    request_id: crypto.randomUUID(),
    profile: { path: "arnold_plan" },
  });
  const calls: {
    profile: OnboardingProfilePatch;
    request_id: string;
    expected_revision: number;
  }[] = [];
  const save = async (
    profile: OnboardingProfilePatch,
    request_id: string,
    expected_revision: number,
  ) => {
    calls.push({ profile, request_id, expected_revision });
    return runtime.onboarding.updateProfile({
      ...claim,
      profile,
      request_id,
      expected_revision,
    });
  };
  const buffer = (initial: OnboardingState, implementation = save) =>
    new OnboardingProfileBuffer({
      initial,
      sessionId: claim.onboarding_session_id,
      save: implementation,
    });
  return { runtime, claim, initial: chosen.state!, calls, save, buffer };
}

describe("local onboarding answers over a slow or unreliable MCP connection", () => {
  it("combines a fast questionnaire into one verified write", async () => {
    const s = await setup();
    const buffer = s.buffer(s.initial);
    buffer.start();
    buffer.stage({ training: { primary_goal: "general_fitness" } });
    buffer.stage({ training: { experience: "beginner" } });
    buffer.stage({ training: { days_per_week: 3 } });
    buffer.stage({ training: { session_minutes: 60 } });
    buffer.stage({ training: { environment: "gym" } });
    expect(s.calls).toHaveLength(0);
    expect(buffer.project().training.environment).toBe("gym");
    expect(buffer.state.session.profile.training.environment).toBeNull();
    expect(await buffer.flush()).toBe(true);
    expect(s.calls).toHaveLength(1);
    expect(buffer.state.session.status).toBe("PROFILE_READY");
    expect(buffer.hasChanges).toBe(false);
  });

  it("keeps later answers while an earlier immutable batch is in flight", async () => {
    const s = await setup();
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const buffer = s.buffer(s.initial, async (...args) => {
      if (first) {
        first = false;
        await slow;
      }
      return s.save(...args);
    });
    buffer.start();
    buffer.stage({ training: { primary_goal: "strength" } });
    const saving = buffer.flush();
    await Promise.resolve();
    buffer.stage({ training: { experience: "beginner" } });
    buffer.stage({ training: { days_per_week: 4 } });
    expect(buffer.project().training.days_per_week).toBe(4);
    expect(buffer.state.session.profile.training.primary_goal).toBeNull();
    release();
    expect(await saving).toBe(true);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0].profile.training).toEqual({ primary_goal: "strength" });
    expect(s.calls[1].profile.training).toEqual({
      experience: "beginner",
      days_per_week: 4,
    });
    expect(s.calls[1].expected_revision).toBe(s.calls[0].expected_revision + 1);
    expect(buffer.hasChanges).toBe(false);
  });

  it("restores an interrupted commit and retries its original id and revision", async () => {
    const s = await setup();
    let loseResponse = true;
    const unreliable = async (...args: Parameters<typeof s.save>) => {
      const response = await s.save(...args);
      if (loseResponse) {
        loseResponse = false;
        throw new Error("lost acknowledgement");
      }
      return response;
    };
    const first = s.buffer(s.initial, unreliable);
    first.start();
    first.stage({ training: { primary_goal: "strength" } });
    expect(await first.flush()).toBe(false);
    expect(first.paused).toBe(true);
    const current = await s.runtime.onboarding.getOnboardingState(s.claim);
    const restored = s.buffer(current, unreliable);
    restored.start();
    expect(restored.paused).toBe(true);
    expect(restored.project().training.primary_goal).toBe("strength");
    expect(await restored.retry()).toBe(true);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]).toEqual(s.calls[0]);
    expect(restored.state.session.revision).toBe(current.session.revision);
    expect(restored.hasChanges).toBe(false);
  });

  it("retains unsent answers across a reload without starting another setup", async () => {
    const s = await setup();
    const first = s.buffer(s.initial);
    first.stage({ person: { height_cm: 181, body_weight_kg: 82.5 } });
    const restored = s.buffer(s.initial);
    expect(restored.project().person).toMatchObject({
      height_cm: 181,
      body_weight_kg: 82.5,
    });
    restored.start();
    expect(await restored.flush()).toBe(true);
    expect(restored.state.session.onboarding_session_id).toBe(
      s.claim.onboarding_session_id,
    );
  });

  it("refuses to silently overwrite a chat update, then saves only after explicit retry", async () => {
    const s = await setup();
    const buffer = s.buffer(s.initial);
    buffer.start();
    buffer.stage({ training: { primary_goal: "general_fitness" } });
    const chat = await s.runtime.onboarding.updateProfile({
      ...s.claim,
      request_id: crypto.randomUUID(),
      profile: { training: { primary_goal: "strength", notes: "Chat answer" } },
    });
    buffer.adopt(chat.state!);
    expect(await buffer.flush()).toBe(false);
    expect(buffer.conflict).toBe(true);
    expect(s.calls).toHaveLength(0);
    expect(buffer.project().training.primary_goal).toBe("general_fitness");
    expect(await buffer.retry()).toBe(true);
    expect(buffer.state.session.profile.training).toMatchObject({
      primary_goal: "general_fitness",
      notes: "Chat answer",
    });
  });

  it("uses the same weekday consistency rules when combining answers", async () => {
    const s = await setup();
    const buffer = s.buffer(s.initial);
    buffer.start();
    buffer.stage({ training: { training_days: ["mon", "wed"] } });
    buffer.stage({ training: { days_per_week: 3 } });
    expect(buffer.project().training.training_days).toBeUndefined();
    expect(await buffer.flush()).toBe(true);
    expect(buffer.state.session.profile.training.days_per_week).toBe(3);
    expect(buffer.state.session.profile.training.training_days).toBeUndefined();
  });

  it("does not overwrite a chat answer that arrived before an older acknowledgement", async () => {
    const s = await setup();
    let acknowledge!: () => void;
    let committed!: () => void;
    const held = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const stored = new Promise<void>((resolve) => {
      committed = resolve;
    });
    const buffer = s.buffer(s.initial, async (...args) => {
      const result = await s.save(...args);
      committed();
      await held;
      return result;
    });
    buffer.start();
    buffer.stage({ training: { primary_goal: "strength" } });
    const saving = buffer.flush();
    await stored;
    buffer.stage({ training: { experience: "beginner" } });
    const chat = await s.runtime.onboarding.updateProfile({
      ...s.claim,
      request_id: crypto.randomUUID(),
      profile: { training: { experience: "advanced" } },
    });
    buffer.adopt(chat.state!);
    acknowledge();
    expect(await saving).toBe(false);
    expect(buffer.conflict).toBe(true);
    expect(s.calls).toHaveLength(1);
    expect(buffer.state.session.profile.training.experience).toBe("advanced");
    expect(buffer.project().training.experience).toBe("beginner");
  });
});
