/**
 * MOB-011: the mobility page of the setup and the mobility rows of "Das habe
 * ich verstanden". Server states come from the fixture runtime, so "fehlt noch"
 * is checked against what the server really lists as open. The clicks
 * themselves are covered in tests/e2e/onboarding-mobility.spec.ts.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import {
  ProfileStep,
  UnderstoodStep,
  hasUnderstood,
  initialProfileQuestion,
  renderMobilityPage,
} from "../src/ui/components/onboarding";
import {
  MOBILITY_DRAFT_DEFAULT,
  draftFromMobility,
  mobilityFromDraft,
  type MobilityDraft,
} from "../src/ui/components/onboarding/mobility-draft";
import { nextPage, previousPage } from "../src/ui/components/onboarding/pages";
import {
  sayExample,
  understoodRows,
} from "../src/ui/components/onboarding/understood-step";
import { MOBILITY_DEFAULTS } from "../src/shared/mobility-contract";
import type {
  OnboardingProfilePatch,
  OnboardingState,
} from "../src/shared/onboarding-contract";

const runtime = createFixtureOnboarding();
const started = await runtime.onboarding.startOnboarding({
  request_id: randomUUID(),
});
const claim = {};
const save = async (profile: OnboardingProfilePatch) =>
  (
    await runtime.onboarding.updateProfile({
      ...claim,
      request_id: randomUUID(),
      profile,
    })
  ).state!;

// Everything required is answered; only mobility may still be asked.
const ready = await save({
  path: "arnold_plan",
  training: {
    primary_goal: "strength",
    experience: "beginner",
    days_per_week: 3,
    session_minutes: 60,
    environment: "gym",
  },
});
const declined = await save({ training: { mobility: { wants: false } } });
const wantedNoAreas = await save({
  training: {
    mobility: {
      wants: true,
      morning: { weekdays: ["mon", "wed", "fri"], minutes: 5 },
      sessions: null,
      stiff_areas: [],
    },
  },
});
const wantedWithAreas = await save({
  training: {
    mobility: {
      wants: true,
      morning: {
        weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        minutes: 10,
      },
      sessions: { placement: "after_strength", per_week: 2, minutes: 20 },
      stiff_areas: ["lower_back", "hips"],
    },
  },
});

const noop = () => {};
const ids = (state: OnboardingState) => state.open_questions.map((q) => q.id);
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node);

const page = (draft: MobilityDraft, scope: "all" | "details" = "all") =>
  html(
    renderMobilityPage({
      head: null,
      errorNote: null,
      actions: null,
      busy: false,
      draft,
      setDraft: noop,
      scope,
    }),
  );
const pressed = (markup: string, label: string) =>
  new RegExp(`aria-pressed="true"[^>]*>${label}</button>`).test(markup);

const understood = (state: OnboardingState, canWritePlan = true) =>
  html(
    <UnderstoodStep
      profile={state.session.profile}
      progress={state.progress}
      canWritePlan={canWritePlan}
      busy={false}
      menu={[]}
      onOpen={noop}
      onForm={noop}
      onRequestPlan={noop}
      openQuestions={ids(state)}
    />,
  );
const missing = (markup: string) => markup.match(/fehlt noch/g)?.length ?? 0;

describe("what the server lists as open", () => {
  it("asks mobility once, details only for a wish without areas", () => {
    expect(ids(ready)).toEqual(["mobility"]);
    expect(ids(declined)).toEqual([]);
    expect(ids(wantedNoAreas)).toEqual(["mobility_details"]);
    expect(ids(wantedWithAreas)).toEqual([]);
  });
});

describe("the mobility page", () => {
  it("renders the first question with four buttons and nothing else yet", () => {
    const markup = page(MOBILITY_DRAFT_DEFAULT);
    expect(markup).toContain("Mobility oder Morgenroutine dazu?");
    for (const label of [
      "Morgenroutine",
      "Mobility-Einheiten",
      "Beides",
      "Nein danke",
    ])
      expect(markup).toContain(`>${label}</button>`);
    // No answer yet: no detail field, no pressed button.
    expect(markup).not.toContain("Tage der Morgenroutine");
    expect(markup).not.toContain("Steife Bereiche");
    expect(markup).not.toContain('aria-pressed="true"');
    // The hint says how to answer by voice, without a health promise.
    expect(markup).toContain("Sag zum Beispiel");
    expect(markup).toContain("Morgens 10 Minuten, meine Hüfte ist steif.");
  });

  it("starts with all seven days, 10 minutes and Arnold decides", () => {
    expect(MOBILITY_DRAFT_DEFAULT.weekdays).toEqual([
      ...MOBILITY_DEFAULTS.morning.weekdays,
    ]);
    expect(MOBILITY_DRAFT_DEFAULT.weekdays).toHaveLength(7);
    expect(MOBILITY_DRAFT_DEFAULT.morningMinutes).toBe(10);
    expect(MOBILITY_DRAFT_DEFAULT.placement).toBe("arnold_decides");
    const both = page({ ...MOBILITY_DRAFT_DEFAULT, choice: "both" });
    for (const day of ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"])
      expect(pressed(both, day)).toBe(true);
    expect(pressed(both, "10 Min.")).toBe(true);
    expect(pressed(both, "5 Min.")).toBe(false);
    expect(pressed(both, "Arnold entscheidet")).toBe(true);
    expect(both).toContain("Tage der Morgenroutine");
    expect(both).toContain("Lage der Mobility-Einheiten");
    // Eight stiff areas, none chosen yet; "steif" is not "Schmerz".
    for (const area of [
      "Nacken",
      "Schultern",
      "Oberer Rücken",
      "Unterer Rücken",
      "Hüfte",
      "Beinrückseite",
      "Waden/Sprunggelenke",
      "Handgelenke",
    ])
      expect(both).toContain(`>${area}</button>`);
    expect(both).not.toMatch(/Schmerz(?!en)/);
  });

  it("shows only the fields of the chosen wish", () => {
    const morning = page({ ...MOBILITY_DRAFT_DEFAULT, choice: "morning" });
    expect(morning).toContain("Tage der Morgenroutine");
    expect(morning).not.toContain("Lage der Mobility-Einheiten");
    const sessions = page({ ...MOBILITY_DRAFT_DEFAULT, choice: "sessions" });
    expect(sessions).not.toContain("Tage der Morgenroutine");
    expect(sessions).toContain("Lage der Mobility-Einheiten");
    const none = page({ ...MOBILITY_DRAFT_DEFAULT, choice: "none" });
    expect(none).not.toContain("Tage der Morgenroutine");
    expect(none).not.toContain("Steife Bereiche");
  });

  it("asks only the stiff areas when the server lists only the details", () => {
    const profile = wantedNoAreas.session.profile;
    const markup = page(
      draftFromMobility(profile.training.mobility),
      "details",
    );
    expect(markup).toContain("Wo fühlst du dich steif?");
    expect(markup).toContain("Steife Bereiche");
    expect(markup).not.toContain("Nein danke");
    expect(markup).not.toContain("Tage der Morgenroutine");
  });
});

describe("what the buttons send", () => {
  it('"Nein danke" sends { wants: false }', () => {
    expect(
      mobilityFromDraft({ ...MOBILITY_DRAFT_DEFAULT, choice: "none" }),
    ).toEqual({ wants: false });
  });

  it('"Beides" sends the morning routine and the sessions with the defaults', () => {
    expect(
      mobilityFromDraft({ ...MOBILITY_DRAFT_DEFAULT, choice: "both" }),
    ).toEqual({
      wants: true,
      morning: {
        weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        minutes: 10,
      },
      sessions: { placement: "arnold_decides", per_week: 2, minutes: 20 },
      stiff_areas: [],
    });
  });

  it("sends only the chosen kind and what was picked", () => {
    expect(
      mobilityFromDraft({
        ...MOBILITY_DRAFT_DEFAULT,
        choice: "morning",
        weekdays: ["fri", "mon", "wed"],
        morningMinutes: 5,
        areas: ["hips", "neck"],
      }),
    ).toEqual({
      wants: true,
      morning: { weekdays: ["mon", "wed", "fri"], minutes: 5 },
      sessions: null,
      // Catalog order, not tap order.
      stiff_areas: ["neck", "hips"],
    });
    expect(
      mobilityFromDraft({
        ...MOBILITY_DRAFT_DEFAULT,
        choice: "sessions",
        placement: "own_days",
      }),
    ).toEqual({
      wants: true,
      morning: null,
      sessions: { placement: "own_days", per_week: 2, minutes: 20 },
      stiff_areas: [],
    });
  });

  it("sends nothing while no wish is chosen or a morning routine has no day", () => {
    expect(mobilityFromDraft(MOBILITY_DRAFT_DEFAULT)).toBeUndefined();
    expect(
      mobilityFromDraft({
        ...MOBILITY_DRAFT_DEFAULT,
        choice: "morning",
        weekdays: [],
      }),
    ).toBeUndefined();
  });

  it("the server takes what the page sends and stores it as sent", () => {
    expect(wantedWithAreas.session.profile.training.mobility).toEqual(
      mobilityFromDraft({
        ...MOBILITY_DRAFT_DEFAULT,
        choice: "both",
        placement: "after_strength",
        areas: ["lower_back", "hips"],
      }),
    );
    // A stored answer seeds the page again as it was.
    expect(
      mobilityFromDraft(
        draftFromMobility(wantedWithAreas.session.profile.training.mobility),
      ),
    ).toEqual(wantedWithAreas.session.profile.training.mobility);
    expect(
      mobilityFromDraft(
        draftFromMobility(wantedNoAreas.session.profile.training.mobility),
      ),
    ).toEqual(wantedNoAreas.session.profile.training.mobility);
  });
});

describe("the way through the setup", () => {
  const training = ready.session.profile;
  it("shows the page after the wishes (or the run page) while mobility is open", () => {
    expect(nextPage("wishes", false, false, false, true)).toBe("mobility");
    expect(nextPage("wishes", false, false, true, true)).toBe("run");
    expect(nextPage("run", false, false, true, true)).toBe("mobility");
    expect(nextPage("mobility", false, false, false, true)).toBe("review");
    expect(previousPage("review", false, false, true)).toBe("mobility");
    expect(previousPage("mobility", false, true, true)).toBe("run");
    expect(previousPage("mobility", false, false, true)).toBe("wishes");
  });

  it("is skipped when the server lists nothing open", () => {
    expect(nextPage("wishes", false)).toBe("review");
    expect(nextPage("run", false, false, true)).toBe("review");
    expect(previousPage("review")).toBe("wishes");
    expect(initialProfileQuestion(training, ids(declined))).toBe("review");
    expect(initialProfileQuestion(training, ids(wantedWithAreas))).toBe(
      "review",
    );
    // Without a list (an old server) the page is not asked either.
    expect(initialProfileQuestion(training)).toBe("review");
    // The form opens on it while only mobility is open.
    expect(initialProfileQuestion(training, ids(ready))).toBe("mobility");
    expect(initialProfileQuestion(training, ids(wantedNoAreas))).toBe(
      "mobility",
    );
  });

  it("opens the card on the page when a row is tapped", () => {
    const markup = html(
      <ProfileStep
        profile={wantedWithAreas.session.profile}
        progress={wantedWithAreas.progress}
        validation={wantedWithAreas.validation}
        exerciseChoices={wantedWithAreas.exercise_choices}
        splitOptions={wantedWithAreas.split_options}
        busy={false}
        canWritePlan
        onSave={async () => true}
        onRequestPlan={noop}
        onBack={noop}
        initialPage="mobility"
        onReturn={noop}
        openQuestions={[]}
      />,
    );
    expect(markup).toContain("Mobility oder Morgenroutine dazu?");
    // Seeding from the stored answer runs in an effect (checked in the
    // browser spec); here the page and its skip button are enough.
    expect(markup).toContain(">Überspringen</button>");
  });
});

describe("the understood card", () => {
  it("counts a stored mobility answer as something understood", () => {
    const only = (
      mobility: OnboardingState["session"]["profile"]["training"]["mobility"],
    ) => ({
      ...started.state!.session.profile,
      path: "arnold_plan" as const,
      training: { ...started.state!.session.profile.training, mobility },
    });
    expect(hasUnderstood(only(undefined))).toBe(false);
    expect(hasUnderstood(only({ wants: false }))).toBe(true);
  });

  it('shows "fehlt noch" for mobility only while the server lists it', () => {
    const open = understood(ready);
    expect(open).toContain("Mobility");
    expect(missing(open)).toBe(1);
    expect(
      sayExample(understoodRows(ready.session.profile, [], noop, ids(ready))),
    ).toBe("Morgens 10 Minuten, meine Hüfte ist steif.");
    expect(open).toContain("Sag zum Beispiel");
    expect(open).toContain("Morgens 10 Minuten, meine Hüfte ist steif.");
    // Decided: the row says so, nothing is missing, no hint.
    const no = understood(declined);
    expect(no).toContain("nicht gewünscht");
    expect(missing(no)).toBe(0);
    expect(no).not.toContain("Sag zum Beispiel");
    // Without the server's list there is no mobility row to call missing.
    const unlisted = html(
      <UnderstoodStep
        profile={ready.session.profile}
        progress={ready.progress}
        canWritePlan
        busy={false}
        menu={[]}
        onOpen={noop}
        onForm={noop}
        onRequestPlan={noop}
      />,
    );
    expect(missing(unlisted)).toBe(0);
    expect(unlisted).not.toContain(">Mobility<");
  });

  it("names the morning routine, the placement and the stiff areas", () => {
    const rows = understoodRows(
      wantedWithAreas.session.profile,
      [],
      noop,
      ids(wantedWithAreas),
    );
    const value = (key: string) => {
      const row = rows.find((r) => r.key === key);
      return row?.value;
    };
    expect(value("morning")).toBe("Jeden Tag · 10 Min.");
    expect(value("mobility")).toBe(
      "Nach dem Krafttraining · 2× pro Woche · 20 Min.",
    );
    expect(value("stiff")).toBe("Unterer Rücken, Hüfte");
    const partial = understoodRows(
      wantedNoAreas.session.profile,
      [],
      noop,
      ids(wantedNoAreas),
    );
    expect(partial.find((r) => r.key === "morning")?.value).toBe(
      "Mo, Mi, Fr · 5 Min.",
    );
    expect(partial.find((r) => r.key === "mobility")?.value).toBe(
      "keine Einheiten",
    );
    // The details question is open, so the stiff row is the gap.
    expect(partial.find((r) => r.key === "stiff")?.value).toBeUndefined();
    expect(sayExample(partial)).toContain("steif");
    expect(missing(understood(wantedNoAreas))).toBe(1);
    expect(missing(understood(wantedWithAreas))).toBe(0);
  });

  it("never lets mobility block the plan button", () => {
    // Mobility is still open, everything required is answered.
    expect(ready.progress.can_request_plan).toBe(true);
    const markup = understood(ready);
    expect(markup).toContain("Plan erstellen");
    expect(markup).toContain("Stimmt das so?");
    expect(markup).not.toContain("Angabe fehlt");
  });
});
