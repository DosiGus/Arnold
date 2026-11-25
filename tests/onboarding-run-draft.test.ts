import { describe, expect, it } from "vitest";
import {
  RUN_DRAFT_DEFAULT,
  draftFromRun,
  durationText,
  parseDuration,
  runFromDraft,
} from "../src/ui/components/onboarding/run-draft";
import { OnboardingRunSchema } from "../src/shared/onboarding-contract";

const FILLED = {
  ...RUN_DRAFT_DEFAULT,
  goal: "10k" as const,
  baseMinutes: 90,
  longestMinutes: 40,
};

describe("run page draft", () => {
  it("reads durations as seconds and rejects unreadable text", () => {
    expect(parseDuration("")).toBeUndefined();
    expect(parseDuration("0:50:00")).toBe(3000);
    expect(parseDuration("25:30")).toBe(1530);
    expect(parseDuration("1:60:00")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("0:00")).toBeNull();
    expect(parseDuration("11:00:00")).toBeNull();
    expect(durationText(3000)).toBe("0:50:00");
  });

  it("needs goal, weekly minutes and longest run; unknown is not 0", () => {
    expect(runFromDraft(RUN_DRAFT_DEFAULT).run).toBeUndefined();
    expect(
      runFromDraft({ ...FILLED, longestMinutes: undefined }).run,
    ).toBeUndefined();
    const { run } = runFromDraft(FILLED);
    expect(OnboardingRunSchema.parse(run)).toMatchObject({
      goal: "10k",
      runs_per_week: 3,
      base_minutes_per_week: 90,
      longest_run_4w_min: 40,
      preferred_environment: "outdoor",
    });
    expect(run).not.toHaveProperty("reference");
    expect(run).not.toHaveProperty("target_time_s");
  });

  it("takes a complete reference or none, never half of one", () => {
    const half = runFromDraft({ ...FILLED, referenceMeters: "5000" });
    expect(half.run).toBeUndefined();
    expect(half.problems.reference).toBeTruthy();
    const full = runFromDraft({
      ...FILLED,
      raceDate: "2027-04-10",
      targetText: "0:50:00",
      referenceMeters: "5000",
      referenceTimeText: "25:30",
      referenceDate: "2026-10-01",
    });
    expect(OnboardingRunSchema.parse(full.run)).toMatchObject({
      race_date: "2027-04-10",
      target_time_s: 3000,
      reference: {
        distance_m: 5000,
        time_s: 1530,
        date: "2026-10-01",
        source: "user",
      },
    });
    expect(draftFromRun(full.run)).toMatchObject({
      referenceMeters: "5000",
      referenceTimeText: "0:25:30",
      targetText: "0:50:00",
    });
    expect(
      runFromDraft({ ...FILLED, targetText: "x" }).problems.target,
    ).toBeTruthy();
  });
});
