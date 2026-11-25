import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import type { OnboardingState } from "../src/shared/onboarding-contract";
import type { PlannedExercise } from "../src/shared/plan-contract";
import type { ArnoldMcpClient } from "../src/ui/client/ArnoldMcpClient";
import {
  PlanCard,
  weekdaysLine,
} from "../src/ui/components/onboarding/plan-card";
import { PlanEditor } from "../src/ui/components/onboarding/plan-editor";
import {
  deviceOf,
  stepDown,
  stepUp,
} from "../src/ui/components/onboarding/plan-device";

/** RDS-009: the plan card, from a real server state with a plan draft. */

const runtime = createFixtureOnboarding();
const service = runtime.onboarding;
await service.startOnboarding({ request_id: randomUUID() });
await service.updateProfile({
  request_id: randomUUID(),
  profile: {
    path: "arnold_plan",
    person: { age_years: 34, height_cm: 180 },
    training: {
      primary_goal: "muscle_gain",
      experience: "intermediate",
      days_per_week: 4,
      session_minutes: 60,
      environment: "gym",
    },
  },
} as never);
await service.requestPlanProposal({ request_id: randomUUID() } as never);
const submitted = await service.submitPlanProposal({
  request_id: randomUUID(),
  name: "Testplan",
  origin: "ai_proposal",
  sessions: [
    ["Push", "plan-fx-bench"],
    ["Pull", "plan-fx-db-bench"],
    ["Beine", "plan-fx-legpress"],
    ["Körper", "plan-fx-pullup"],
  ].map(([session_name, exercise_id]) => ({
    session_name,
    exercises: [{ exercise_id, target_sets: 3, rep_min: 8, rep_max: 12 }],
  })),
} as never);
expect(submitted.ok, submitted.error?.message).toBe(true);
const state = submitted.state as OnboardingState;

const plain = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const client = {} as ArnoldMcpClient;
const card = (s: OnboardingState, saving = false) =>
  renderToStaticMarkup(
    <PlanCard
      client={client}
      state={s}
      saving={saving}
      onConfirm={async () => ({ ok: true })}
      onChanged={() => {}}
      onDone={() => {}}
    />,
  );
const items = state.plan!.sessions.flatMap((s) => s.exercises);
const byId = (id: string) => items.find((i) => i.exercise_id === id)!;

describe("Plan card", () => {
  it("builds the title and the tiles from the server plan", () => {
    const html = card(state);
    const words = plain(html);
    expect(words).toContain("Dein Plan: 4 Tage, je 60 Min.");
    expect(words).toContain("34 Jahre, 180 cm");
    expect(words).toContain("Module: Krafttraining");
    for (const name of ["Push", "Pull", "Beine", "Körper"])
      expect(words).toContain(name);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(4);
    expect(words.match(/1 Übung/g)).toHaveLength(4);
    expect(html).toContain('class="oc-tiles"');
  });

  it("has exactly two actions and the voice hint as text, not as a button", () => {
    const html = card(state);
    expect(html.match(/<button[^>]*class="ac-btn/g)).toHaveLength(2);
    const words = plain(html);
    expect(words).toContain("Plan bestätigen");
    expect(words).toContain("Selbst bearbeiten");
    expect(words).toContain("Oder sag mir einfach, was ich ändern soll.");
  });

  it("shows no morning routine or running row the server did not deliver", () => {
    const words = plain(card(state));
    expect(words).not.toContain("Morgenroutine");
    expect(words).not.toContain("Laufen");
  });

  it("shows morning routine and running rows only from plan data", () => {
    const plan = state.plan!;
    const withExtras = {
      ...state,
      plan: {
        ...plan,
        mobility_sessions: [
          {
            kind: "morning",
            status: "active",
            weekdays: [5, 1, 3],
            minutes: 10,
          },
          { kind: "session", status: "active", weekdays: [], minutes: 20 },
        ],
        run_sessions: [{ status: "active" }, { status: "active" }],
      },
    } as unknown as OnboardingState;
    const words = plain(card(withExtras));
    expect(words).toContain("Morgenroutine: Mo, Mi, Fr, je 10 Min.");
    expect(words).toContain("Laufen: 2× pro Woche, zusätzlich");
    expect(weekdaysLine([7, 1])).toBe("Mo, So");
  });

  it("shows plan errors as a hint and blocks confirming", () => {
    const bad = {
      ...state,
      plan_validation: {
        valid: false,
        errors: [{ code: "X", message: "Eine Übung fehlt im Katalog." }],
        warnings: [],
      },
    } as unknown as OnboardingState;
    const html = card(bad);
    expect(plain(html)).toContain("Eine Übung fehlt im Katalog.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Plan bestätigen/);
  });

  it("waits without a plan: two disabled actions, no tiles", () => {
    const html = card({ ...state, plan: null, plan_validation: null });
    expect(html).not.toContain("oc-tiles");
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
  });

  it("is a labelled region whose title takes focus", () => {
    const html = card(state);
    expect(html).toContain('data-ocard="plan"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-live="polite"');
  });
});

describe("Plan editor steps by equipment", () => {
  it("uses 2,5 kg for the barbell, 2 kg for dumbbells, 5 kg for machines", () => {
    const bar = deviceOf(byId("plan-fx-bench"))!;
    const dumb = deviceOf(byId("plan-fx-db-bench"))!;
    const mach = deviceOf(byId("plan-fx-legpress"))!;
    expect([bar.step, dumb.step, mach.step]).toEqual([2.5, 2, 5]);
    expect(stepUp(60, bar)).toBe(62.5);
    expect(stepUp(20, dumb)).toBe(22);
    expect(stepUp(40, mach)).toBe(45);
    expect(stepDown(62.5, bar)).toBe(60);
  });

  it("stops at the lowest weight per device and starts there from unknown", () => {
    const bar = deviceOf(byId("plan-fx-bench"))!;
    const dumb = deviceOf(byId("plan-fx-db-bench"))!;
    const mach = deviceOf(byId("plan-fx-legpress"))!;
    expect(stepDown(22.5, bar)).toBe(20);
    expect(stepDown(20, bar)).toBeNull();
    expect(stepDown(4, dumb)).toBe(2);
    expect(stepDown(2, dumb)).toBeNull();
    expect(stepDown(5, mach)).toBeNull();
    expect(stepDown(null, mach)).toBeNull();
    expect(stepUp(null, bar)).toBe(bar.min);
    expect(stepUp(null, mach)).toBe(5);
  });

  it("gives bodyweight exercises no steps", () => {
    expect(deviceOf(byId("plan-fx-pullup") as PlannedExercise)).toBeUndefined();
  });

  it("renders plus and minus per weighted row, the server version and no steps for bodyweight", () => {
    const html = renderToStaticMarkup(
      <PlanEditor
        client={client}
        plan={state.plan!}
        onChanged={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html.match(/ weniger"/g)).toHaveLength(3);
    expect(html.match(/ mehr"/g)).toHaveLength(3);
    expect(plain(html)).toContain(`Version ${state.plan!.row_revision}`);
    expect(plain(html)).toContain("Körpergewicht");
    expect(plain(html)).toContain("Zurück zum Chat");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Speichern/);
  });
});
