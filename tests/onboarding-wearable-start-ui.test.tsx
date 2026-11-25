import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import type { OnboardingState } from "../src/shared/onboarding-contract";
import { normalizeWatchUserCode } from "../src/shared/watch-contract";
import type { ArnoldMcpClient } from "../src/ui/client/ArnoldMcpClient";
import { ArnoldToolError } from "../src/ui/recovery";
import {
  CODE_FAILED,
  CODE_RATE_LIMITED,
  CODE_WRONG,
  WearableCard,
  pairingError,
} from "../src/ui/components/onboarding/wearable-card";
import {
  StartCard,
  type StartData,
} from "../src/ui/components/onboarding/start-card";

/** RDS-010: the cards "wearable" and "start", from a real server state. */

const runtime = createFixtureOnboarding();
const service = runtime.onboarding;
await service.startOnboarding({ request_id: randomUUID() });
const saved = await service.updateProfile({
  request_id: randomUUID(),
  profile: {
    path: "arnold_plan",
    person: { age_years: 34, height_cm: 180 },
    training: {
      primary_goal: "muscle_gain",
      secondary_goals: ["fat_loss"],
      experience: "intermediate",
      days_per_week: 4,
      session_minutes: 60,
      environment: "gym",
      known_loads: { "bench-press": { kg: 82.5, reps: 5 } },
    },
  },
} as never);
expect(saved.ok, saved.error?.message).toBe(true);
const state = saved.state as OnboardingState;
const empty = createFixtureOnboarding();
const started = await empty.onboarding.startOnboarding({
  request_id: randomUUID(),
});
const bare = started.state as OnboardingState;

const plain = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const client = {} as ArnoldMcpClient;
const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) =>
    plain(m[1]).trim(),
  );

describe("code normalising", () => {
  it("takes the code with or without hyphen, any case, with spaces", () => {
    for (const raw of ["ABCD2345", "abcd-2345", " AbCd 2345 ", "ABCD-2345"])
      expect(normalizeWatchUserCode(raw)).toBe("ABCD2345");
  });
  it("refuses wrong length and letters outside the alphabet", () => {
    for (const raw of ["ABCD234", "ABCD23456", "ABCD-O105", "", "ab-cd"])
      expect(normalizeWatchUserCode(raw)).toBeNull();
  });
});

describe("pairing errors", () => {
  const failure = (code: string) =>
    new ArnoldToolError({ code, recovery: "none" });
  it("says what is wrong at the field, without internal text", () => {
    expect(pairingError(failure("VALIDATION_ERROR"))).toBe(CODE_WRONG);
    expect(pairingError(failure("RATE_LIMITED"))).toBe(CODE_RATE_LIMITED);
    expect(pairingError(new Error("boom"))).toBe(CODE_FAILED);
    for (const text of [CODE_WRONG, CODE_RATE_LIMITED, CODE_FAILED])
      expect(text).not.toMatch(/[A-Z]{2,}_[A-Z_]+|device_id|request_id/);
  });
});

describe("Wearable card", () => {
  const html = renderToStaticMarkup(
    <WearableCard client={client} state={state} onDone={() => {}} />,
  );
  it("shows the sentence, one code field and exactly two actions", () => {
    expect(plain(html)).toContain(
      "Öffne Arnold auf deiner Uhr. Dort steht ein Code mit 8 Zeichen.",
    );
    expect(plain(html)).toContain("Garmin verbinden");
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(buttons(html)).toEqual(["Verbinden", "Später"]);
    expect(html).toContain('aria-live="polite"');
  });
  it("asks for no consent and names no other watch", () => {
    const words = plain(html);
    expect(words).not.toMatch(/Einwilligung|Gesundheitsdaten|Apple/);
  });
  it("shows no summary line for an unconfirmed plan", () => {
    expect(plain(html)).not.toContain("Plan: Bestätigt");
  });
});

describe("Start card", () => {
  const data: StartData = {
    watches: 1,
    home: {
      next_session: {
        plan_version_id: "pv",
        session_id: "s1",
        session_name: "Push",
        exercise_count: 5,
      },
      streak: { weekly_goal: 4, current_week_training_days: 2 },
    } as never,
  };
  const card = (s: OnboardingState, d: StartData) =>
    renderToStaticMarkup(<StartCard client={client} state={s} data={d} />);

  it("shows the server values, estimated maxima and exactly two actions", () => {
    const html = card(state, data);
    const words = plain(html);
    expect(words).toContain("Arnold ist bereit");
    expect(words).toContain("Nächste Einheit: Push, 5 Übungen");
    expect(words).toContain("Woche: 2 von 4 Trainingstagen");
    expect(words).toContain("Ziele:");
    expect(words).toContain("Richtwerte (geschätzt):");
    expect(words).toContain("ca. 82,5 kg × 5");
    expect(words).toContain("Verbunden. Öffne Arnold auf der Uhr.");
    expect(words).not.toMatch(/Rekord/);
    expect(buttons(html)).toEqual(["Einheit ansehen", "Plan öffnen"]);
    expect(words).not.toMatch(/auf die Uhr spielen/);
    expect(words).not.toMatch(/\b[a-f0-9]{8}-[a-f0-9]{4}\b|plan_version_id/);
  });
  it("leaves unknown values open, never 0", () => {
    const words = plain(card(bare, {}));
    expect(words).toContain("Nächste Einheit: noch offen");
    expect(words).toContain("Ziele: noch offen");
    expect(words).toContain("noch offen, Arnold schätzt sie");
    expect(words).not.toContain("Woche:");
    expect(words).not.toContain("Uhr:");
    expect(words).not.toMatch(/\b0 (kg|von|Übungen)/);
  });
  it("says briefly when no watch is connected", () => {
    const words = plain(card(state, { ...data, watches: 0 }));
    expect(words).toContain("Noch nicht verbunden");
    expect(words).not.toContain("Öffne Arnold auf der Uhr");
  });
});
