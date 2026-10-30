/**
 * Onboarding components against real service output.
 *
 * These render the actual components with state produced by the real
 * `OnboardingService`, so a contract change the wizard cannot display fails
 * here rather than in a browser. They assert what a user reads and what a screen
 * reader is given, not implementation details.
 *
 * Three claims get the most attention, because they are the ones that would be
 * most harmful to get wrong: no storage enum ever reaches the screen, no control
 * pretends to do something unavailable, and nothing says a Google file exists.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChipGroup,
  ChoiceGroup,
  GoogleConnectionHandoffStep,
  OnboardingErrorState,
  OnboardingIssues,
  OnboardingProgressBar,
  OnboardingResumeState,
  OwnPlanStep,
  PlanConfirmationDialog,
  PlanGenerationStep,
  ProfileStep,
  WelcomeStep,
  parseList,
} from "../src/ui/components/onboarding";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import {
  BODY_AREAS,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  ONBOARDING_PATHS,
  SEXES,
  SPLITS,
  TRAINING_ENVIRONMENTS,
  TRAINING_GOALS,
  type OnboardingState,
} from "../src/shared/onboarding-contract";

const rid = () => randomUUID();
const noop = () => {};

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node);

/** Visible text only, with the entities React escapes turned back. */
const text = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  render(node)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&#xE4;/g, "ä")
    .replace(/&#xF6;/g, "ö")
    .replace(/&#xFC;/g, "ü")
    .replace(/&#xDF;/g, "ß")
    .replace(/\s+/g, " ")
    .trim();

const COMPLETE = {
  path: "arnold_plan",
  training: {
    primary_goal: "muscle_gain",
    experience: "intermediate",
    days_per_week: 3,
    session_minutes: 60,
    environment: "gym",
  },
} as const;

/** Real server state, so the components are tested against the real contract. */
async function realState(): Promise<{
  proposed: OnboardingState;
  confirmed: OnboardingState;
  fresh: OnboardingState;
  started: OnboardingState;
  ready: OnboardingState;
}> {
  const runtime = createFixtureOnboarding();
  const service = runtime.onboarding;
  const started = await service.startOnboarding({ request_id: rid() });
  const claim = {
    onboarding_session_id: started.state!.session.onboarding_session_id,
    session_token: started.session_token!,
  };
  const started2 = await service.updateProfile({
    request_id: rid(),
    ...claim,
    profile: { path: "arnold_plan" },
  });
  const ready = await service.updateProfile({
    request_id: rid(),
    ...claim,
    profile: COMPLETE,
  });
  await service.requestPlanProposal({ request_id: rid(), ...claim });
  const brief = await service.getBrief(claim);
  const ids = brief.exercise_catalog.slice(0, 3).map((e) => e.exercise_id);
  const submitted = await service.submitPlanProposal({
    request_id: rid(),
    ...claim,
    name: "Push/Pull/Legs",
    origin: "ai_proposal",
    sessions: ["Push", "Pull", "Legs"].map((name, index) => ({
      session_name: name,
      exercises: [
        { exercise_id: ids[index], target_sets: 3, rep_min: 8, rep_max: 12 },
      ],
    })),
  });
  const plan = submitted.state!.plan!;
  const confirmed = await service.confirmPlan({
    request_id: rid(),
    ...claim,
    confirmation: {
      plan_version_id: plan.plan_version_id,
      row_revision: plan.row_revision,
      confirmed: true,
    },
  });
  return {
    fresh: started.state!,
    started: started2.state!,
    ready: ready.state!,
    proposed: submitted.state!,
    confirmed: confirmed.state!,
  };
}

const states = await realState();

/* ------------------------------------------------------------- the welcome */

describe("the welcome step", () => {
  const node = (
    <WelcomeStep onChoose={noop} busy={false} canWritePlan googleAvailable />
  );

  it("says who Arnold is and offers exactly the two ways in", () => {
    const output = text(node);
    expect(output).toContain("Willkommen bei Arnold");
    expect(output).toContain("Trainingsbegleiter");
    expect(output).toContain("Plan mit Arnold erstellen");
    expect(output).toContain("Eigenen Plan übernehmen");
    const markup = render(node);
    expect(markup.match(/class="onb-path /g)).toHaveLength(2);
    expect(markup).toContain('role="group"');
  });

  it("does not promise Google where it is unavailable", () => {
    const output = text(
      <WelcomeStep onChoose={noop} busy={false} canWritePlan />,
    );
    expect(output).toContain("Google-Verbindung nicht verfügbar");
    expect(output).toMatch(/keine Datei erstellt/i);
  });

  it("says so when a plan cannot be stored at all", () => {
    const output = text(
      <WelcomeStep onChoose={noop} busy={false} canWritePlan={false} />,
    );
    expect(output).toMatch(/Eingeschränkte Umgebung/i);
    expect(output).toMatch(/kein Planentwurf gespeichert/i);
  });
});

/* ------------------------------------------------------------- the choices */

describe("choices", () => {
  it("renders accessible radio groups with a legend", () => {
    const markup = render(
      <ChoiceGroup
        legend="Wie oft möchtest du pro Woche trainieren?"
        options={[
          { value: 1, label: "1" },
          { value: 2, label: "2" },
        ]}
        value={2}
        onChange={noop}
        name="days_per_week"
      />,
    );
    expect(markup).toContain("<fieldset");
    expect(markup).toContain("<legend>");
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('name="days_per_week"');
    expect(markup).toContain("checked");
    expect(markup).toContain("selected");
  });

  it("renders multiple choices as checkbox chips and respects a limit", () => {
    const markup = render(
      <ChipGroup
        legend="Schwerpunkt"
        options={[
          { value: "a", label: "Brust" },
          { value: "b", label: "Rücken" },
          { value: "c", label: "Beine" },
        ]}
        values={["a", "b"]}
        onChange={noop}
        max={2}
        name="focus"
      />,
    );
    expect(markup).toContain('type="checkbox"');
    expect(markup.match(/checked=""/g)).toHaveLength(2);
    // The third chip cannot be added once the limit is reached.
    expect(markup.match(/disabled=""/g)).toHaveLength(1);
  });

  it("anchors a validation message at the group that caused it", () => {
    const markup = render(
      <ChoiceGroup
        legend="Dein Ziel"
        options={[{ value: "muscle_gain", label: "Muskeln aufbauen" }]}
        value={null}
        onChange={noop}
        error="Trainingsziel fehlt noch."
        name="primary_goal"
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("aria-describedby");
    expect(text(markup)).toContain("Trainingsziel fehlt noch.");
  });

  it("splits a comma list and drops empties", () => {
    expect(parseList("Bankdrücken, Klimmzüge ,, ")).toEqual([
      "Bankdrücken",
      "Klimmzüge",
    ]);
    expect(parseList("   ")).toEqual([]);
  });
});

/* ------------------------------------------------------ the profile cards */

const cards = (
  state: OnboardingState,
  open: "person" | "training" | null,
  overrides: Partial<Parameters<typeof ProfileStep>[0]> = {},
) => (
  <ProfileStep
    profile={state.session.profile}
    progress={state.progress}
    validation={state.validation}
    exerciseChoices={state.exercise_choices}
    splitOptions={state.split_options}
    busy={false}
    canWritePlan
    onSave={async () => true}
    onRequestPlan={noop}
    onBack={noop}
    initiallyOpen={open}
    {...overrides}
  />
);

describe("the profile cards", () => {
  it("shows the two cards as closed buttons with their state", () => {
    const markup = render(cards(states.proposed, null));
    expect(markup.match(/aria-expanded="false"/g)).toHaveLength(2);
    const output = text(markup);
    expect(output).toContain("Person");
    expect(output).toContain("freiwillig");
    expect(output).toContain("Training");
    // The finished Training card summarises its answers.
    expect(output).toContain("Muskeln aufbauen");
    expect(output).toContain("3 × pro Woche");
  });

  it("opens one card at a time", () => {
    const markup = render(cards(states.proposed, "training"));
    expect(markup.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(text(markup)).toContain("Was ist dein Ziel?");
    expect(text(markup)).not.toContain("Bereiche, die du schonen möchtest");
  });

  it("asks for the person's basics and body areas, without a diagnosis", () => {
    const output = text(cards(states.proposed, "person"));
    for (const label of ["Alter", "Größe", "Gewicht", "Geschlecht"])
      expect(output).toContain(label);
    expect(output).toContain("Bereiche, die du schonen möchtest");
    expect(output).toContain("Knie");
    expect(output).toContain("Keine Diagnose nötig");
    expect(output).not.toMatch(/Verletzung|Krankheit|Medikament/i);
  });

  it("asks the trainer's questions on the Training card", () => {
    const output = text(cards(states.proposed, "training"));
    for (const question of [
      "Was ist dein Ziel?",
      "Wie lange trainierst du schon?",
      "An welchen Tagen kannst du trainieren?",
      "Wie oft pro Woche?",
      "Wie viel Zeit hast du pro Training?",
      "Wo trainierst du?",
      "Bevorzugst du eine Aufteilung?",
      "Worauf soll der Schwerpunkt liegen?",
      "Welche Übungen machst du gern?",
    ])
      expect(output).toContain(question);
    expect(output).toContain("Draußen");
    expect(output).toContain("Arnold entscheidet");
  });

  it("offers only the splits that fit the days", () => {
    // Three days: full body or push/pull/legs, not upper/lower.
    const output = text(cards(states.proposed, "training"));
    expect(output).toContain("Push / Pull / Beine");
    expect(output).not.toContain("Oberkörper / Unterkörper");
  });

  it("groups the exercise picker by muscle group", () => {
    const output = text(cards(states.proposed, "training"));
    for (const group of ["Brust", "Rücken", "Beine", "Bauch"])
      expect(output).toContain(group);
    expect(output).toContain("Bankdrücken");
    expect(output).toContain("Kniebeugen");
  });

  it("asks about equipment only away from the gym", () => {
    expect(text(cards(states.proposed, "training"))).not.toContain(
      "Welche Geräte hast du?",
    );
    const home = {
      ...states.proposed.session.profile,
      training: {
        ...states.proposed.session.profile.training,
        environment: "home" as const,
      },
    };
    expect(
      text(cards(states.proposed, "training", { profile: home })),
    ).toContain("Welche Geräte hast du?");
  });

  it("names what is missing and keeps 'Plan erstellen' disabled until then", () => {
    const markup = render(cards(states.started, "training"));
    expect(text(markup)).toContain("Für deinen Plan fehlt noch");
    expect(text(markup)).toContain("Trainingsziel");
    expect(markup).toMatch(/disabled=""[^>]*>[^<]*<svg[^>]*>.*?Plan erstellen/);
  });

  it("enables 'Plan erstellen' once the Training card is complete", () => {
    const ready = render(cards(states.ready, null));
    expect(text(ready)).toContain("Plan erstellen");
    expect(ready).not.toMatch(
      /disabled=""[^>]*>[^<]*<svg[^>]*>.*?Plan erstellen/,
    );
  });
});

/* --------------------------------------------------------------- no enums */

describe("no storage value is ever shown", () => {
  const forbidden = [
    ...TRAINING_GOALS,
    ...EXPERIENCE_LEVELS,
    ...TRAINING_ENVIRONMENTS,
    ...ONBOARDING_PATHS,
    ...SPLITS.filter((split) => split !== "auto"),
    ...SEXES,
    ...BODY_AREAS,
    ...EQUIPMENT,
  ];

  const screens = () => [
    text(<WelcomeStep onChoose={noop} busy={false} canWritePlan />),
    text(cards(states.proposed, "person")),
    text(cards(states.proposed, "training")),
    text(
      <OwnPlanStep
        onBack={noop}
        onAskChat={noop}
        onReload={noop}
        busy={false}
      />,
    ),
  ];

  it("shows German labels instead of enum keys", () => {
    for (const output of screens())
      for (const value of forbidden)
        expect(output, `"${value}" leaked into the interface`).not.toMatch(
          new RegExp(`\\b${value}\\b`),
        );
  });

  it("never shows a technical identifier", () => {
    const output = screens().join(" ");
    expect(output).not.toContain(states.proposed.session.onboarding_session_id);
    expect(output).not.toContain(states.proposed.plan!.plan_version_id);
    expect(output).not.toContain(states.proposed.session.tracker_id);
    expect(output).not.toContain("bench-press");
  });
});

/* -------------------------------------------------------------- progress */

describe("progress", () => {
  it("is announced as a progress bar with the real counts", () => {
    const markup = render(
      <OnboardingProgressBar progress={states.proposed.progress} />,
    );
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain("aria-valuenow");
    expect(text(markup)).toContain("Angaben vollständig.");
  });

  it("counts an incomplete profile honestly", () => {
    const output = text(
      <OnboardingProgressBar progress={states.started.progress} />,
    );
    expect(output).toContain("1 / 6");
  });
});

/* ---------------------------------------------------------- the own plan */

describe("taking over an own plan", () => {
  const output = text(
    <OwnPlanStep onBack={noop} onAskChat={noop} onReload={noop} busy={false} />,
  );

  it("says the plan comes through the chat, as text or a photo", () => {
    expect(output).toContain("Deinen Plan übernehmen");
    expect(output).toMatch(/Chat/);
    expect(output).toMatch(/Foto/);
    expect(output).toMatch(/ergänzen/i);
  });

  it("offers to continue in the chat and a real reload", () => {
    expect(output).toContain("Im Chat weitermachen");
    expect(output).toContain("Nach dem Plan suchen");
  });
});

/* ------------------------------------------------------- plan generation */

describe("the plan generation step", () => {
  const node = (
    <PlanGenerationStep
      daysPerWeek={3}
      minutes={60}
      path="arnold_plan"
      onBack={noop}
      onReload={noop}
      busy={false}
    />
  );

  it("directs the user to the chat instead of faking a generator", () => {
    const output = text(node);
    expect(output).toContain("Chat");
    expect(output).toContain("Erstelle mir jetzt den Trainingsplan");
    // The one control is a real reload, not a sham "generate" button.
    expect(output).toContain("Nach dem Vorschlag suchen");
    expect(output).not.toMatch(/Plan jetzt generieren|KI starten/i);
  });

  it("says that unstated loads stay empty", () => {
    expect(text(node)).toMatch(/erfindet keine Trainingsgewichte/i);
  });

  it("adapts the wording for an own plan", () => {
    expect(
      text(
        <PlanGenerationStep
          daysPerWeek={3}
          minutes={60}
          path="own_plan"
          onBack={noop}
          onReload={noop}
          busy={false}
        />,
      ),
    ).toContain("Übernimm meinen bestehenden Trainingsplan");
  });
});

/* ----------------------------------------------------------- confirmation */

describe("the confirmation dialog", () => {
  const plan = states.proposed.plan!;
  const node = (
    <PlanConfirmationDialog
      planName={plan.name}
      revision={plan.row_revision}
      sessionCount={plan.session_count}
      exerciseCount={plan.exercise_count}
      onConfirm={noop}
      onCancel={noop}
      busy={false}
    />
  );

  it("is a real modal dialog", () => {
    const markup = render(node);
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("aria-labelledby");
  });

  it("names the exact revision being released", () => {
    const output = text(node);
    expect(output).toContain(plan.name);
    expect(output).toContain(`Revision ${plan.row_revision}`);
    expect(output).toContain(`${plan.session_count} Trainingseinheiten`);
  });

  it("states that this is not an activation in Google", () => {
    const output = text(node);
    expect(output).toMatch(/noch nicht/i);
    expect(output).toContain("Google");
    expect(output).toMatch(/erneut bestätigen/i);
  });
});

/* --------------------------------------------------------------- handoff */

describe("the Google handoff step", () => {
  const plan = states.confirmed.plan!;
  const node = (
    <GoogleConnectionHandoffStep
      planName={plan.name}
      revision={states.confirmed.handoff.confirmed_plan_revision!}
      sessionCount={plan.session_count}
      exerciseCount={plan.exercise_count}
      onRevise={noop}
      busy={false}
    />
  );

  it("announces the plan as ready and released", () => {
    const output = text(node);
    expect(output).toContain("Dein Trainingsplan ist bereit.");
    expect(output).toContain("bestätigt");
    expect(output).toContain("verbinden wir dein Google-Konto");
  });

  it("disables the Google button and labels it as the next step", () => {
    const markup = render(node);
    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-disabled="true"');
    expect(text(markup)).toContain("Nächster Entwicklungsschritt");
  });

  it("never claims a Google file exists", () => {
    const output = text(node);
    expect(output).toMatch(/kein Google-Konto verbunden/i);
    expect(output).toMatch(/keine Datei angelegt/i);
    expect(output).not.toMatch(
      /Datei (wurde )?erstellt|erfolgreich verbunden|Einrichtung abgeschlossen/i,
    );
  });

  it("offers a late change and warns that it voids the confirmation", () => {
    const output = text(node);
    expect(output).toContain("Plan doch noch ändern");
    expect(output).toMatch(/Bestätigung ungültig/i);
  });
});

/* ----------------------------------------------------------------- states */

describe("error and resume states", () => {
  it("offers a retry and a restart on an error", () => {
    const markup = render(
      <OnboardingErrorState
        message="Verbindung unterbrochen."
        onRetry={noop}
        onRestart={noop}
      />,
    );
    expect(markup).toContain('role="alert"');
    const output = text(markup);
    expect(output).toContain("Verbindung unterbrochen.");
    expect(output).toContain("Erneut versuchen");
    expect(output).toContain("Einrichtung neu starten");
  });

  it("explains an expired setup and offers a controlled restart", () => {
    const output = text(
      <OnboardingResumeState kind="expired" onRestart={noop} busy={false} />,
    );
    expect(output).toContain("abgelaufen");
    expect(output).toContain("Neue Einrichtung starten");
    // No false claim that the old answers are still recoverable.
    expect(output).toMatch(/nicht mehr abrufbar/i);
  });

  it("explains a cancelled setup and that the draft is kept", () => {
    const output = text(
      <OnboardingResumeState kind="cancelled" onRestart={noop} busy={false} />,
    );
    expect(output).toContain("abgebrochen");
    expect(output).toMatch(/nicht gelöscht/i);
  });

  it("shows warnings and recommendations without alarm", () => {
    const markup = render(
      <OnboardingIssues
        validation={{
          valid: true,
          errors: [],
          warnings: [
            {
              code: "PREFERRED_EXERCISE_UNAVAILABLE",
              severity: "warning",
              message: "Beinpresse ist zuhause nicht möglich.",
              field: null,
              step: "profile",
            },
          ],
          recommendations: [
            {
              code: "IMPLAUSIBLE_DAYS_PER_WEEK",
              severity: "recommendation",
              message: "Sieben Tage lassen wenig Erholung.",
              field: null,
              step: "profile",
            },
          ],
        }}
        step="profile"
      />,
    );
    const output = text(markup);
    expect(output).toContain("Beinpresse ist zuhause nicht möglich.");
    expect(output).toContain("Sieben Tage lassen wenig Erholung.");
    // A recommendation is not an alert.
    expect(markup).toContain('role="status"');
  });
});

/* ----------------------------------------------------- no fake affordances */

describe("no misleading claims anywhere", () => {
  it("never reports a completed setup before Google", () => {
    const plan = states.confirmed.plan!;
    const screens = [
      text(
        <GoogleConnectionHandoffStep
          planName={plan.name}
          revision={plan.row_revision}
          sessionCount={plan.session_count}
          exerciseCount={plan.exercise_count}
          onRevise={noop}
          busy={false}
        />,
      ),
      text(<WelcomeStep onChoose={noop} busy={false} canWritePlan />),
    ].join(" ");
    expect(screens).not.toMatch(/Einrichtung (ist )?abgeschlossen/i);
    expect(screens).not.toMatch(/Tracker (wurde )?erstellt/i);
    expect(screens).not.toMatch(/Plan (ist )?aktiviert/i);
  });

  it("keeps the confirmed state out of a COMPLETED status", () => {
    expect(states.confirmed.session.status).toBe("AWAITING_GOOGLE_CONNECTION");
    expect(states.confirmed.handoff.status).toBe("ready_for_google_connection");
    expect(states.confirmed.handoff.google_connection_pending).toBe(true);
  });
});
