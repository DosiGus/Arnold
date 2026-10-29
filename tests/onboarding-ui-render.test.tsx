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
  AvailabilityStep,
  ChoiceGroup,
  GoalStep,
  GoogleConnectionHandoffStep,
  OnboardingErrorState,
  OnboardingIssues,
  OnboardingProgressBar,
  OnboardingResumeState,
  PlanConfirmationDialog,
  PlanGenerationStep,
  PreferencesStep,
  ProfileSummaryStep,
  WelcomeStep,
  parseList,
} from "../src/ui/components/onboarding";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import {
  EXPERIENCE_LEVELS,
  STARTING_POINTS,
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
  primary_goal: "muscle_gain",
  experience: "intermediate",
  days_per_week: 3,
  session_minutes: 60,
  environment: "gym",
  starting_point: "new_plan",
} as const;

/** Real server state, so the components are tested against the real contract. */
async function realState(): Promise<{
  proposed: OnboardingState;
  confirmed: OnboardingState;
  fresh: OnboardingState;
}> {
  const runtime = createFixtureOnboarding();
  const service = runtime.onboarding;
  const started = await service.startOnboarding({ request_id: rid() });
  const claim = {
    onboarding_session_id: started.state!.session.onboarding_session_id,
    session_token: started.session_token!,
  };
  await service.updateProfile({
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
    proposed: submitted.state!,
    confirmed: confirmed.state!,
  };
}

const states = await realState();

/* ------------------------------------------------------------- the welcome */

describe("the welcome step", () => {
  it("explains the setup without promising Google", () => {
    const output = text(
      <WelcomeStep onStart={noop} busy={false} resumed={false} canWritePlan />,
    );
    expect(output).toContain("Willkommen bei Arnold");
    expect(output).toContain("Einrichtung starten");
    // Said up front, not discovered at the end: the Google step is named *and*
    // explicitly negated, so a reader cannot take it as already done.
    expect(output).toContain("Google-Verbindung nicht verfügbar");
    expect(output).toMatch(/keine Datei erstellt/i);
  });

  it("offers to continue when answers already exist", () => {
    expect(
      text(<WelcomeStep onStart={noop} busy={false} resumed canWritePlan />),
    ).toContain("Einrichtung fortsetzen");
  });

  it("says so when a plan cannot be stored at all", () => {
    const output = text(
      <WelcomeStep
        onStart={noop}
        busy={false}
        resumed={false}
        canWritePlan={false}
      />,
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
    // The chosen option is marked for the browser and for assistive tech.
    expect(markup).toContain("checked");
    expect(markup).toContain("selected");
  });

  it("anchors a validation message at the group that caused it", () => {
    const markup = render(
      <ChoiceGroup
        legend="Dein Ziel"
        options={[{ value: "muscle_gain", label: "Muskelaufbau" }]}
        value={null}
        onChange={noop}
        error="Trainingsziel fehlt noch."
        name="primary_goal"
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("aria-describedby");
    expect(markup).toContain("invalid");
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

/* --------------------------------------------------------------- no enums */

describe("no storage value is ever shown", () => {
  const forbidden = [
    ...TRAINING_GOALS,
    ...EXPERIENCE_LEVELS,
    ...TRAINING_ENVIRONMENTS,
    ...STARTING_POINTS,
  ];

  const screens = () => {
    const profile = states.proposed.session.profile;
    return [
      text(
        <GoalStep
          goal={profile.primary_goal}
          experience={profile.experience}
          validation={states.proposed.validation}
          onChange={noop}
          onNext={noop}
          busy={false}
          showErrors={false}
        />,
      ),
      text(
        <AvailabilityStep
          days={profile.days_per_week}
          minutes={profile.session_minutes}
          environment={profile.environment}
          validation={states.proposed.validation}
          onChange={noop}
          onNext={noop}
          onBack={noop}
          busy={false}
          showErrors={false}
        />,
      ),
      text(
        <PreferencesStep
          startingPoint={profile.starting_point}
          preferred=""
          avoided=""
          equipment=""
          notes=""
          validation={states.proposed.validation}
          onChange={noop}
          onNext={noop}
          onBack={noop}
          busy={false}
          showErrors={false}
        />,
      ),
      text(
        <ProfileSummaryStep
          summary={{
            goal: profile.primary_goal,
            experience: profile.experience,
            days: profile.days_per_week,
            minutes: profile.session_minutes,
            environment: profile.environment,
            startingPoint: profile.starting_point,
            preferred: [],
            avoided: [],
            equipment: [],
          }}
          progress={states.proposed.progress}
          validation={states.proposed.validation}
          onEdit={noop}
          onRequestPlan={noop}
          onBack={noop}
          busy={false}
          canRequestPlan
          canWritePlan
        />,
      ),
    ];
  };

  it("shows German labels instead of enum keys", () => {
    for (const output of screens())
      for (const value of forbidden)
        expect(output, `"${value}" leaked into the interface`).not.toContain(
          value,
        );
  });

  it("shows the German label for the chosen values", () => {
    const output = screens().join(" ");
    expect(output).toContain("Muskelaufbau");
    expect(output).toContain("Fortgeschritten");
    expect(output).toContain("Fitnessstudio");
  });

  it("never shows a technical identifier", () => {
    const output = screens().join(" ");
    expect(output).not.toContain(states.proposed.session.onboarding_session_id);
    expect(output).not.toContain(states.proposed.plan!.plan_version_id);
    expect(output).not.toContain(states.proposed.session.tracker_id);
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
    expect(markup).toContain("aria-label");
    expect(text(markup)).toContain("Angaben vollständig.");
  });

  it("counts an incomplete profile honestly", () => {
    const output = text(
      <OnboardingProgressBar
        progress={{
          ...states.fresh.progress,
          answered_required: 2,
          total_required: 6,
          profile_complete: false,
        }}
      />,
    );
    expect(output).toContain("2 / 6");
  });
});

/* --------------------------------------------------------------- summary */

describe("the summary", () => {
  const profile = states.proposed.session.profile;
  const node = (
    <ProfileSummaryStep
      summary={{
        goal: profile.primary_goal,
        experience: profile.experience,
        days: profile.days_per_week,
        minutes: profile.session_minutes,
        environment: profile.environment,
        startingPoint: profile.starting_point,
        preferred: ["Bankdrücken"],
        avoided: ["Kniebeugen"],
        equipment: [],
        notes: "Am liebsten morgens.",
      }}
      progress={states.proposed.progress}
      validation={states.proposed.validation}
      onEdit={noop}
      onRequestPlan={noop}
      onBack={noop}
      busy={false}
      canRequestPlan
      canWritePlan
    />
  );

  it("lists the answers with a change control each", () => {
    const output = text(node);
    expect(output).toContain("3 Tage pro Woche");
    expect(output).toContain("60 Minuten je Training");
    expect(output).toContain("Bankdrücken");
    expect(output).toContain("Am liebsten morgens.");
    // Every row is editable, which is what "alle Werte veränderbar" means.
    const markup = render(node);
    expect(markup.match(/ändern/gi)!.length).toBeGreaterThanOrEqual(6);
  });

  it("marks what is still missing rather than hiding it", () => {
    const output = text(
      <ProfileSummaryStep
        summary={{
          goal: null,
          experience: profile.experience,
          days: profile.days_per_week,
          minutes: profile.session_minutes,
          environment: profile.environment,
          startingPoint: profile.starting_point,
          preferred: [],
          avoided: [],
          equipment: [],
        }}
        progress={{
          ...states.proposed.progress,
          profile_complete: false,
          missing_fields: ["primary_goal"],
        }}
        validation={states.proposed.validation}
        onEdit={noop}
        onRequestPlan={noop}
        onBack={noop}
        busy={false}
        canRequestPlan={false}
        canWritePlan
      />,
    );
    expect(output).toContain("Noch offen");
    expect(output).toContain("Es fehlen noch Angaben");
    expect(output).toContain("Trainingsziel");
  });

  it("disables the plan request while answers are missing", () => {
    const markup = render(
      <ProfileSummaryStep
        summary={{
          goal: null,
          experience: null,
          days: null,
          minutes: null,
          environment: null,
          startingPoint: null,
          preferred: [],
          avoided: [],
          equipment: [],
        }}
        progress={{ ...states.fresh.progress, profile_complete: false }}
        validation={states.fresh.validation}
        onEdit={noop}
        onRequestPlan={noop}
        onBack={noop}
        busy={false}
        canRequestPlan={false}
        canWritePlan
      />,
    );
    expect(markup).toContain("disabled");
  });
});

/* ------------------------------------------------------- plan generation */

describe("the plan generation step", () => {
  const node = (
    <PlanGenerationStep
      daysPerWeek={3}
      minutes={60}
      startingPoint="new_plan"
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

  it("adapts the wording for an existing routine", () => {
    expect(
      text(
        <PlanGenerationStep
          daysPerWeek={3}
          minutes={60}
          startingPoint="existing_plan"
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
              code: "EXISTING_ROUTINE_INCOMPLETE",
              severity: "warning",
              message: "Für Push fehlen Sätze.",
              field: null,
              step: "preferences",
            },
          ],
          recommendations: [
            {
              code: "IMPLAUSIBLE_DAYS_PER_WEEK",
              severity: "recommendation",
              message: "Sieben Tage lassen wenig Erholung.",
              field: null,
              step: "preferences",
            },
          ],
        }}
        step="preferences"
      />,
    );
    const output = text(markup);
    expect(output).toContain("Für Push fehlen Sätze.");
    expect(output).toContain("Sieben Tage lassen wenig Erholung.");
    // A recommendation is not an alert.
    expect(markup).toContain('role="status"');
  });
});

/* ------------------------------------------------- the existing-plan path */

describe("taking over an existing plan", () => {
  it("explains how to describe a routine in the chat", () => {
    const output = text(
      <PreferencesStep
        startingPoint="existing_plan"
        preferred=""
        avoided=""
        equipment=""
        notes=""
        validation={states.proposed.validation}
        onChange={noop}
        onNext={noop}
        onBack={noop}
        busy={false}
        showErrors={false}
      />,
    );
    expect(output).toContain("Push/Pull/Legs");
    expect(output).toMatch(/strukturiert/i);
    expect(output).toMatch(/ergänzen/i);
  });

  it("offers a genuine skip for the optional questions", () => {
    const output = text(
      <PreferencesStep
        startingPoint="new_plan"
        preferred=""
        avoided=""
        equipment=""
        notes=""
        validation={states.proposed.validation}
        onChange={noop}
        onNext={noop}
        onBack={noop}
        busy={false}
        showErrors={false}
      />,
    );
    expect(output).toContain("Optionale Angaben überspringen");
  });

  it("asks for no health information and says so", () => {
    const output = text(
      <PreferencesStep
        startingPoint="new_plan"
        preferred=""
        avoided=""
        equipment=""
        notes=""
        validation={states.proposed.validation}
        onChange={noop}
        onNext={noop}
        onBack={noop}
        busy={false}
        showErrors={false}
      />,
    );
    expect(output).toMatch(/keine Gesundheits-/i);
    expect(output).toMatch(/keine medizinischen/i);
    // And no field invites a diagnosis.
    expect(output).not.toMatch(/Verletzung|Diagnose|Krankheit[^s]/i);
  });
});

/* ----------------------------------------------------- no fake affordances */

describe("no misleading claims anywhere", () => {
  it("never reports a completed setup in Task 006", () => {
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
      text(
        <WelcomeStep
          onStart={noop}
          busy={false}
          resumed={false}
          canWritePlan
        />,
      ),
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
