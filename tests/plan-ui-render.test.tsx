/**
 * Plan editor components against real service output.
 *
 * These render the actual components with payloads produced by the real
 * `TrainingPlanService`, so a contract change the editor cannot display fails
 * here rather than in a browser. They assert what a user reads and what a
 * screen reader is given, not implementation details.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ExercisePicker,
  ExerciseSettingsPanel,
  PlanActivationDialog,
  PlanChangeSummary,
  PlanOverview,
  PlanValidationPanel,
  PlanVersionHistory,
  TrainingSessionCard,
  targetSummary,
  targetsFromDraft,
} from "../src/ui/components/plan";
import { PLAN_STATE_TEXT } from "../src/ui/hooks/usePlanEditor";
import { PLAN_EDITOR_STATES } from "../src/shared/plan-contract";
import { harness, itemOf, session, type Harness } from "./fixtures/arnold-plan";
import type {
  PlannedExercise,
  TrainingPlanVersion,
  TrainingSession,
} from "../src/shared/plan-contract";

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node);
const text = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  render(node)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&#xE4;/g, "ä")
    .replace(/\s+/g, " ")
    .trim();

const noop = () => {};
const sessionActions = () => ({
  onRename: noop,
  onMove: noop,
  onDuplicate: noop,
  onRemove: noop,
  onAddExercise: noop,
  exerciseActions: () => ({
    onMove: noop,
    onReplace: noop,
    onRemove: noop,
    onSettings: noop,
    onQuickSave: noop,
  }),
});

async function activePlan(h: Harness): Promise<TrainingPlanVersion> {
  return (await h.plans.getPlan({ plan_version_id: "pfx-v2" })).plan;
}

describe("the plan overview", () => {
  it("shows the plan, its split and its facts without technical ids", async () => {
    const h = harness();
    const plan = await activePlan(h);
    const output = text(<PlanOverview plan={plan} isActive />);
    expect(output).toContain("Push Pull Legs angepasst");
    expect(output).toContain("Aktiv");
    expect(output).not.toContain("Version 2");
    expect(output).toContain("3 Trainingstage pro Woche");
    expect(output).toContain("Trainingseinheiten");
    expect(output).toContain("Übungen");
    // A technical id is never the primary label.
    expect(output).not.toContain("pfx-v2");
  });
});

describe("a training session card", () => {
  it("lists exercises in order with their targets", async () => {
    const h = harness();
    const plan = await activePlan(h);
    const push = plan.sessions.find((s) => s.session_name === "Push")!;
    const output = text(
      <TrainingSessionCard
        session={push}
        position={1}
        total={3}
        editable={false}
      />,
    );
    expect(output).toContain("Push");
    expect(output).toContain("Demo Bankdrücken");
    expect(output).toContain("Demo Schrägbankdrücken");
    expect(output).toContain("Demo Seitheben");
    expect(output).toContain("3 Übungen");
    // Targets are named as targets, with their load convention.
    expect(output).toContain("4 Sätze");
    expect(output).toContain("6–8 Wdh.");
    expect(output).toContain("Ziel 75 kg");
    expect(output).toContain("kg pro Hantel");
    // The unit is never doubled: the load convention text owns the "kg".
    expect(output).not.toContain("kg kg");
  });

  it("offers no edit controls when it is not editable", async () => {
    const h = harness();
    const plan = await activePlan(h);
    const markup = render(
      <TrainingSessionCard
        session={plan.sessions[0]}
        position={1}
        total={3}
        editable={false}
      />,
    );
    expect(markup).not.toContain("umbenennen");
    expect(markup).not.toContain("duplizieren");
    expect(markup).not.toContain("Übung hinzufügen");
  });

  it("exposes every edit action with an accessible name", async () => {
    const h = harness();
    const plan = await activePlan(h);
    const push = plan.sessions.find((s) => s.session_name === "Push")!;
    const markup = render(
      <TrainingSessionCard
        session={push}
        position={1}
        total={3}
        editable
        actions={sessionActions()}
      />,
    );
    for (const label of [
      "Push umbenennen",
      "Push nach oben verschieben",
      "Push nach unten verschieben",
      "Push duplizieren",
      "Push aus dem Entwurf entfernen",
      "Zielwerte von Demo Bankdrücken bearbeiten",
      "Demo Bankdrücken austauschen",
      "Demo Bankdrücken nach unten verschieben",
      "Weitere Einstellungen für Demo Bankdrücken",
      "Demo Bankdrücken aus dem Entwurf entfernen",
    ])
      expect(markup, label).toContain(`aria-label="${label}"`);
    // Reordering past the ends is disabled rather than silently ignored.
    expect(markup).toContain("Übung hinzufügen");
    expect(markup).toMatch(
      /disabled[^>]*aria-label="Push nach oben verschieben"/,
    );
  });

  it("marks a session that cannot be stored yet", () => {
    const local: TrainingSession = {
      session_id: "local-1",
      session_name: "Arme",
      session_order: 4,
      exercises: [],
      removed_exercise_count: 0,
      persisted: false,
    };
    const output = text(
      <TrainingSessionCard
        session={local}
        position={4}
        total={4}
        editable
        actions={sessionActions()}
      />,
    );
    expect(output).toContain("Noch nicht gespeichert");
    expect(output).toContain(
      "Füge eine Übung hinzu, um diese Einheit zu speichern.",
    );
    expect(output).toContain("Noch keine Übung in dieser Einheit.");
  });

  it("shows a validation error on the exercise it belongs to", async () => {
    const h = harness();
    const plan = await activePlan(h);
    const push = plan.sessions.find((s) => s.session_name === "Push")!;
    const bench = push.exercises[0];
    const markup = render(
      <TrainingSessionCard
        session={push}
        position={1}
        total={3}
        editable
        actions={sessionActions()}
        validation={{
          valid: false,
          plan_version_id: plan.plan_version_id,
          row_revision: plan.row_revision,
          status: "draft",
          schema_id: "arnold.training_raw",
          schema_version: "1.0.0",
          errors: [
            {
              code: "INVALID_REP_RANGE",
              severity: "error",
              message:
                "Das Wiederholungsminimum darf nicht größer als das Maximum sein.",
              session_id: push.session_id,
              plan_item_id: bench.plan_item_id,
              exercise_id: bench.exercise_id,
              field: "rep_max",
            },
          ],
          warnings: [],
          recommendations: [],
          activatable: false,
        }}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(text(markup as never)).toContain("Wiederholungsminimum");
    expect(markup).toContain("has-error");
  });

  it("marks a retired catalog entry", async () => {
    const h = harness("empty");
    await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Mit ausgemusterter Übung",
      sessions: [session("Push", ["plan-fx-retired"])],
    });
    const plan = (await h.plans.getPlan()).plan;
    const output = text(
      <TrainingSessionCard
        session={plan.sessions[0]}
        position={1}
        total={1}
        editable={false}
      />,
    );
    expect(output).toContain("Ausgemustert");
  });
});

describe("the target summary", () => {
  it("never shows a bare weight without its convention", async () => {
    const h = harness();
    const plan = await activePlan(h);
    const dumbbell = itemOf(plan, "plan-fx-incline", "Push");
    expect(targetSummary(dumbbell)).toContain("kg pro Hantel");
    const barbell = itemOf(plan, "plan-fx-bench", "Push");
    expect(targetSummary(barbell)).toContain("Ziel 75 kg");
    expect(targetSummary(barbell)).not.toContain("pro Hantel");
  });

  it("names a bodyweight exercise instead of printing zero", async () => {
    const h = harness();
    const plan = await activePlan(h);
    const pullup = itemOf(plan, "plan-fx-pullup", "Pull");
    expect(targetSummary(pullup)).toContain("Körpergewicht");
    expect(targetSummary(pullup)).not.toContain("0 kg");
  });

  it("names a unilateral execution", async () => {
    const h = harness();
    const plan = await activePlan(h);
    const row = itemOf(plan, "plan-fx-row", "Pull");
    expect(targetSummary(row)).toContain("Einseitig");
  });

  it("says so when no targets are set", () => {
    const bare: PlannedExercise = {
      plan_item_id: "i1",
      session_id: "s1",
      exercise_id: "e1",
      exercise_name: "Testübung",
      exercise_equipment: "",
      exercise_primary_muscle: "",
      exercise_active: true,
      exercise_order: 1,
      target_sets: null,
      rep_min: null,
      rep_max: null,
      target_load_kg: null,
      target_load_basis: null,
      target_execution_mode: null,
      target_implement_count: null,
      rest_seconds: null,
      notes: null,
      status: "active",
      row_revision: 1,
    };
    expect(targetSummary(bare)).toBe("Noch keine Zielwerte");
  });
});

describe("the validation panel", () => {
  it("separates errors, hints and recommendations", async () => {
    const h = harness("empty");
    const created = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Rotierend",
      days_per_week: 4,
      sessions: [
        { session_name: "A", exercises: [{ exercise_id: "plan-fx-bench" }] },
        { session_name: "B", exercises: [{ exercise_id: "plan-fx-squat" }] },
      ],
    });
    const output = text(
      <PlanValidationPanel validation={created.validation!} />,
    );
    expect(output).toContain("Plan ist gültig");
    expect(output).toContain("Hinweise");
    expect(output).toContain("Empfehlungen");
    expect(output).not.toContain("DAYS_PER_WEEK_MISMATCH");
    expect(output).toMatch(
      /Trainingstage|Trainingshäufigkeit|Trainingseinheiten/,
    );
    expect(output).not.toContain("MISSING_TARGET_SETS");
    expect(output).toContain("Zielsätze");
    // A recommendation is never presented as a blocking failure.
    expect(output).not.toContain("Blockierende Fehler");
  });

  it("warns about unsaved local sessions", async () => {
    const h = harness("empty");
    const created = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Test",
      sessions: [session("A")],
    });
    const output = text(
      <PlanValidationPanel validation={created.validation!} hasUnsavedLocal />,
    );
    expect(output).toContain("ohne Übung, die noch nicht gespeichert sind");
  });

  it("reports a draft that cannot be activated", async () => {
    const h = harness();
    const validation = await h.plans.validate({ plan_version_id: "pfx-v2" });
    const output = text(<PlanValidationPanel validation={validation} />);
    expect(output).toContain("noch nicht aktivierbar");
    expect(output).not.toContain("PLAN_NOT_A_DRAFT");
  });
});

describe("the change summary", () => {
  it("groups the differences in plain language", async () => {
    const h = harness();
    const comparison = await h.plans.compare({
      from_plan_version_id: "pfx-v1",
      to_plan_version_id: "pfx-v2",
    });
    const output = text(<PlanChangeSummary comparison={comparison} />);
    expect(output).toContain("Das ändert sich");
    expect(output).toContain("Übungen hinzugefügt");
    expect(output).toContain("Demo Schrägbankdrücken");
    expect(output).toContain("Übungen");
  });

  it("says plainly when nothing differs", async () => {
    const h = harness();
    const comparison = await h.plans.compare({
      from_plan_version_id: "pfx-v2",
      to_plan_version_id: "pfx-v2",
    });
    const output = text(<PlanChangeSummary comparison={comparison} />);
    expect(output).toContain("Keine inhaltlichen Unterschiede");
  });
});

describe("the version history", () => {
  it("lists every version with its status and lifecycle dates", async () => {
    const h = harness();
    const context = await h.plans.context();
    const output = text(
      <PlanVersionHistory
        families={context.families}
        activePlanVersionId={context.active_plan_version_id}
        currentPlanVersionId="pfx-v2"
        onView={noop}
        onReuse={noop}
      />,
    );
    expect(output).toContain("Version 1");
    expect(output).toContain("Version 2");
    expect(output).toContain("Archiviert");
    expect(output).toContain("Aktiv");
    expect(output).toContain("Wieder verwenden");
    expect(output).toContain(
      "frühere Versionen bleiben".replace("frühere", "Frühere"),
    );
  });

  it("does not offer to reuse the version that is already active", async () => {
    const h = harness();
    const context = await h.plans.context();
    const markup = render(
      <PlanVersionHistory
        families={context.families}
        activePlanVersionId="pfx-v2"
        currentPlanVersionId="pfx-v2"
        onView={noop}
        onReuse={noop}
      />,
    );
    // Exactly one archived version offers reuse.
    expect(markup.match(/Wieder verwenden/g)).toHaveLength(1);
  });
});

describe("the activation dialog", () => {
  it("names the exact version and revision being confirmed", async () => {
    const h = harness();
    const created = await h.ok("create_plan_version", {
      request_id: "r1",
      source_plan_version_id: "pfx-v2",
    });
    const version = created.plan!.version;
    const markup = render(
      <PlanActivationDialog plan={version} onConfirm={noop} onClose={noop} />,
    );
    const output = text(markup as never);
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(output).toContain("Trainingsplan aktivieren");
    expect(output).toContain("Deine bisherigen Trainingsdaten bleiben");
    expect(output).toContain("Bestätigen und aktivieren");
    expect(output).not.toContain(version.plan_version_id);
    expect(output).toContain(version.name);
    expect(output).toContain("angezeigte Version");
    // It states what happens to the previous version and to running workouts.
    expect(output).toContain("archiviert und bleibt lesbar");
    expect(output).toContain("laufende Trainings behalten");
    // Every session is listed, so the confirmation is about something concrete.
    for (const name of ["Push", "Pull", "Legs"]) expect(output).toContain(name);
  });
});

describe("the exercise picker", () => {
  it("offers the catalog with equipment and load convention", async () => {
    const h = harness();
    const context = await h.plans.context();
    const output = text(
      <ExercisePicker
        exercises={context.exercises}
        title="Übung hinzufügen"
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(output).toContain("Übung suchen");
    expect(output).toContain("Demo Bankdrücken");
    expect(output).toContain("Gesamtgewicht");
    expect(output).toContain("kg pro Hantel");
    expect(output).toContain("Einseitig");
    // Retired entries are not offered.
    expect(output).not.toContain("ausgemustert");
  });

  it("reports how many exercises are available", async () => {
    const h = harness();
    const context = await h.plans.context();
    const output = text(
      <ExercisePicker
        exercises={context.exercises}
        title="Übung hinzufügen"
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(output).toMatch(/\d+ Übungen gefunden/);
  });
});

describe("the exercise settings panel", () => {
  it("shows every target field and labels the weight as a target", async () => {
    const h = harness();
    const plan = await activePlan(h);
    const bench = itemOf(plan, "plan-fx-bench", "Push");
    const output = text(
      <ExerciseSettingsPanel exercise={bench} onSave={noop} onClose={noop} />,
    );
    expect(output).toContain("Zielsätze");
    expect(output).toContain("Wiederholungen von");
    expect(output).toContain("Wiederholungen bis");
    expect(output).toContain("Zielgewicht (kg)");
    expect(output).toContain("Gewichtsdefinition");
    expect(output).toContain("Ausführung");
    expect(output).toContain("Anzahl Geräte");
    expect(output).toContain("Pause (Sekunden)");
    expect(output).toContain("Notiz");
    expect(output).toContain("Zielgewicht (kg)");
    expect(output).not.toContain("Planposition");
  });

  it("disables the target weight for a bodyweight exercise", async () => {
    const h = harness();
    const plan = await activePlan(h);
    const pullup = itemOf(plan, "plan-fx-pullup", "Pull");
    const markup = render(
      <ExerciseSettingsPanel exercise={pullup} onSave={noop} onClose={noop} />,
    );
    expect(markup).toContain("disabled");
    expect(text(markup as never)).toContain("Zusatzgewicht");
  });

  it("turns empty form fields into null rather than zero", () => {
    expect(
      targetsFromDraft({
        target_sets: "",
        rep_min: "",
        rep_max: "",
        target_load_kg: "",
        target_load_basis: "",
        target_execution_mode: "",
        target_implement_count: "",
        rest_seconds: "",
        notes: "   ",
      }),
    ).toEqual({
      target_sets: null,
      rep_min: null,
      rep_max: null,
      target_load_kg: null,
      target_load_basis: null,
      target_execution_mode: null,
      target_implement_count: null,
      rest_seconds: null,
      notes: null,
    });
  });

  it("keeps the numbers it was given", () => {
    expect(
      targetsFromDraft({
        target_sets: "4",
        rep_min: "6",
        rep_max: "8",
        target_load_kg: "82.5",
        target_load_basis: "per_implement",
        target_execution_mode: "unilateral",
        target_implement_count: "1",
        rest_seconds: "150",
        notes: " langsam ",
      }),
    ).toEqual({
      target_sets: 4,
      rep_min: 6,
      rep_max: 8,
      target_load_kg: 82.5,
      target_load_basis: "per_implement",
      target_execution_mode: "unilateral",
      target_implement_count: 1,
      rest_seconds: 150,
      notes: "langsam",
    });
  });
});

describe("editor states", () => {
  it("has user-facing text for every documented state", () => {
    for (const state of PLAN_EDITOR_STATES) {
      expect(PLAN_STATE_TEXT[state], state).toBeTruthy();
      expect(PLAN_STATE_TEXT[state].length, state).toBeGreaterThan(5);
    }
  });
});
