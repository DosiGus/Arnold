/**
 * Profile completeness, validation and the brief ChatGPT builds a plan from.
 *
 * Pure functions only: a profile in, findings or a brief out. The service
 * applies them; nothing here reads a clock or storage except through the
 * arguments it is given.
 *
 * The distinction that matters most is between an *error* and a *recommendation*.
 * A missing goal blocks a plan proposal. Six training days at 30 minutes is a
 * perfectly legitimate choice and only earns a note. Arnold does not refuse to
 * help because it would have planned differently, and it does not silently
 * rewrite an answer it finds unusual — an implausible number is refused at the
 * schema boundary and everything inside the band is the user's call.
 *
 * Nothing in this module makes a health claim. Body areas a user wants to go
 * easy on are passed on as a training preference ("load carefully"), never as
 * a diagnosis, an assessment or a training clearance.
 */
import type { ArnoldExercise } from "./arnold-schema-v1.js";
import {
  BODY_AREA_LABEL,
  ENVIRONMENT_LABEL,
  EQUIPMENT_LABEL,
  EXPERIENCE_LABEL,
  FIELD_STEP,
  GOAL_LABEL,
  MISSING_FIELD_CODE,
  MUSCLE_GROUP_LABEL,
  ONBOARDING_CONTRACT,
  PERSON_BASICS,
  REQUIRED_FIELD_LABEL,
  SESSION_MINUTES_MAX,
  SESSION_MINUTES_MIN,
  SPLIT_LABEL,
  WEEKDAY_LABEL,
  requiredFieldsFor,
  splitsForDays,
  type ExerciseChoice,
  type OnboardingBrief,
  type OnboardingProfile,
  type OnboardingProfilePatch,
  WEEKDAYS,
  type OnboardingProgress,
  type OnboardingStep,
  type OpenQuestion,
  type OnboardingValidationIssue,
  type OnboardingValidationResult,
  type RequiredProfileField,
  type TrainingSessionInputLike,
} from "./onboarding-contract.js";
import { exercisesFor, starterExercise } from "./exercise-starter-catalog.js";
import { MOBILITY_CATALOG } from "./mobility-catalog.js";
import {
  MOBILITY_DEFAULTS,
  MobilityPreferenceSchema,
  type MobilityPreference,
} from "./mobility-contract.js";

/** Whether "Ausdauer und Laufen" is a main or a further goal. */
export function wantsRunning(training: OnboardingProfile["training"]): boolean {
  return (
    training.primary_goal === "endurance_running" ||
    (training.secondary_goals ?? []).includes("endurance_running")
  );
}

/**
 * The run details a running goal needs before a plan can be asked for. They
 * are required answers of the run step; unknown is unknown, never 0.
 */
export function runSetupState(training: OnboardingProfile["training"]): {
  required: boolean;
  ready: boolean;
} {
  const required = wantsRunning(training);
  return { required, ready: !required || training.run !== undefined };
}

/** The value behind a required field name. */
function valueOf(profile: OnboardingProfile, field: RequiredProfileField) {
  if (field === "path") return profile.path;
  const key = field.slice("training.".length) as keyof typeof profile.training;
  return profile.training[key] ?? null;
}

/** The required answers that are still missing, in asking order. */
export function missingRequiredFields(
  profile: OnboardingProfile,
): RequiredProfileField[] {
  return requiredFieldsFor(profile.path).filter(
    (field) => valueOf(profile, field) === null,
  );
}

/**
 * The first collection step that still lacks a required answer.
 *
 * Recorded after a save without an explicit step, so the stored position says
 * what to ask next. Left at "goal" after the goal was answered, a chat client
 * reads it as "the goal is still open" and asks — and saves — it again.
 */
export function firstOpenStep(
  profile: OnboardingProfile,
): OnboardingStep | undefined {
  const field = missingRequiredFields(profile)[0];
  return field ? FIELD_STEP[field] : undefined;
}

export const isProfileComplete = (profile: OnboardingProfile) =>
  profile.path !== null && missingRequiredFields(profile).length === 0;

/** The question a missing required answer is asked with; short enough to read aloud. */
const REQUIRED_QUESTION: Record<RequiredProfileField, string> = {
  path: "Soll Arnold deinen Plan erstellen, oder möchtest du deinen eigenen Plan übernehmen?",
  "training.primary_goal":
    "Was ist dein Hauptziel – Muskeln aufbauen, stärker werden, abnehmen, fit bleiben oder Laufen?",
  "training.experience":
    "Wie viel Trainingserfahrung hast du – Anfänger, Fortgeschritten oder Erfahren?",
  "training.days_per_week":
    "An wie vielen Tagen pro Woche möchtest du trainieren?",
  "training.session_minutes": "Wie lange darf ein Training dauern?",
  "training.environment":
    "Wo trainierst du – im Studio, zuhause, draußen oder gemischt?",
};

/**
 * What the setup may still ask, in asking order.
 *
 * Required answers first (in the order of `missingRequiredFields`), then the
 * run details a running goal needs, then the mobility question, asked once.
 * Mobility is never required: it does not change `profile_complete` or any
 * plan gate. `wants: false` is a final answer and is never asked again.
 *
 * `mobility_details` stays open while the user wants mobility and has not
 * named stiff areas. The contract has no flag for "asked and nothing is
 * stiff", so a chat client asks it once and does not repeat it.
 */
export function openQuestions(
  profile: OnboardingProfile,
  runSetup: { required: boolean; ready: boolean },
): OpenQuestion[] {
  const questions: OpenQuestion[] = missingRequiredFields(profile).map(
    (field) => ({
      id: field,
      kind: "required" as const,
      ask: REQUIRED_QUESTION[field],
      fields: [field],
    }),
  );
  if (runSetup.required && !runSetup.ready)
    questions.push({
      id: "run_details",
      kind: "required",
      ask: "Fürs Laufen: Welches Ziel, wie oft pro Woche, wie viele Minuten und wie lang war dein längster Lauf zuletzt?",
      fields: ["training.run"],
    });
  const mobility = profile.training.mobility;
  if (mobility === undefined)
    questions.push({
      id: "mobility",
      kind: "ask_once",
      ask: "Sollen eine Morgenroutine oder Mobility-Einheiten dazukommen?",
      fields: ["training.mobility"],
    });
  else if (mobility.wants && mobility.stiff_areas.length === 0)
    questions.push({
      id: "mobility_details",
      kind: "ask_once",
      ask: mobilityDetailsAsk(mobility),
      fields: ["training.mobility.stiff_areas"],
    });
  return questions;
}

function mobilityDetailsAsk(
  mobility: Extract<MobilityPreference, { wants: true }>,
): string {
  const morning = mobility.morning;
  const plan = morning
    ? `${morning.weekdays.length === 7 ? "Jeden Tag" : `An ${morning.weekdays.length} Tagen pro Woche`} ${morning.minutes} Minuten Morgenroutine – passt das?`
    : `${mobility.sessions!.per_week} Mobility-Einheiten pro Woche – passt das?`;
  return `${plan} Und wo fühlst du dich steif?`;
}

/** The Person card's check mark: all four basics answered. */
export const isPersonComplete = (profile: OnboardingProfile) =>
  PERSON_BASICS.every((field) => profile.person[field] !== undefined);

const issue = (
  severity: OnboardingValidationIssue["severity"],
  partial: Omit<OnboardingValidationIssue, "severity">,
): OnboardingValidationIssue => ({ severity, ...partial });

/**
 * Validates the profile as it currently stands.
 *
 * Called on every read, so the UI always shows findings for the state the
 * server actually holds rather than for what the client last sent.
 */
export function validateProfile(
  profile: OnboardingProfile,
): OnboardingValidationResult {
  const found: OnboardingValidationIssue[] = [];

  for (const field of missingRequiredFields(profile))
    found.push(
      issue("error", {
        code: MISSING_FIELD_CODE[field],
        message:
          field === "path"
            ? "Wähle zuerst, ob Arnold deinen Plan erstellt oder du deinen eigenen Plan übernimmst."
            : `${REQUIRED_FIELD_LABEL[field]} fehlt noch.`,
        field,
        step: FIELD_STEP[field],
      }),
    );

  // The rest is about the Training card, which only the Arnold path fills.
  if (profile.path !== "arnold_plan") return result(found);

  const training = profile.training;

  // Inside the accepted band, an unusual combination is information, never a
  // refusal. Outside it, the schema has already rejected the value.
  if (training.session_minutes !== null) {
    if (
      training.session_minutes < SESSION_MINUTES_MIN ||
      training.session_minutes > SESSION_MINUTES_MAX
    )
      found.push(
        issue("error", {
          code: "IMPLAUSIBLE_SESSION_MINUTES",
          message: `Die Trainingsdauer sollte zwischen ${SESSION_MINUTES_MIN} und ${SESSION_MINUTES_MAX} Minuten liegen.`,
          field: "training.session_minutes",
          step: "profile",
        }),
      );
    else if (training.session_minutes <= 30)
      found.push(
        issue("recommendation", {
          code: "IMPLAUSIBLE_SESSION_MINUTES",
          message:
            "Bei 30 Minuten pro Einheit bleiben wenige Übungen pro Training. Der Plan wird entsprechend kompakt.",
          field: "training.session_minutes",
          step: "profile",
        }),
      );
  }

  if (training.days_per_week !== null && training.days_per_week >= 6)
    found.push(
      issue("recommendation", {
        code: "IMPLAUSIBLE_DAYS_PER_WEEK",
        message:
          "Sechs oder sieben Trainingstage pro Woche lassen wenig Zeit zur Erholung. Das ist möglich, braucht aber eine durchdachte Aufteilung.",
        field: "training.days_per_week",
        step: "profile",
      }),
    );

  // A split that does not fit the days is the user's call, but worth a word:
  // push/pull/legs on two days leaves a muscle group untrained for a week.
  if (
    training.split &&
    training.split !== "auto" &&
    training.days_per_week !== null &&
    !splitsForDays(training.days_per_week).includes(training.split)
  )
    found.push(
      issue("recommendation", {
        code: "SPLIT_DAYS_MISMATCH",
        message: `${SPLIT_LABEL[training.split]} passt nicht gut zu ${training.days_per_week} Trainingstagen. Arnold plant so, dass jede Muskelgruppe trotzdem regelmäßig drankommt.`,
        field: "training.split",
        step: "profile",
      }),
    );

  if (
    (training.environment === "home" || training.environment === "outdoor") &&
    (training.equipment?.length ?? 0) === 0
  )
    found.push(
      issue("recommendation", {
        code: "EQUIPMENT_ENVIRONMENT_MISMATCH",
        message:
          training.environment === "home"
            ? "Für ein Training zuhause hilft es zu wissen, welche Geräte vorhanden sind. Ohne Angabe plant Arnold mit dem eigenen Körpergewicht."
            : "Ohne eigene Geräte plant Arnold draußen mit Körpergewicht, Klimmzugstange und Barren.",
        field: "training.equipment",
        step: "profile",
      }),
    );

  // A favourite the user cannot do where they train is kept, not dropped —
  // they may train elsewhere sometimes — but they should know.
  if (training.environment !== null) {
    const possible = new Set(
      exercisesFor(training.environment, training.equipment ?? []).map(
        (exercise) => exercise.exercise_id,
      ),
    );
    const unavailable = (training.preferred_exercise_ids ?? []).filter(
      (exercise) => !possible.has(exercise),
    );
    if (unavailable.length)
      found.push(
        issue("warning", {
          code: "PREFERRED_EXERCISE_UNAVAILABLE",
          message: `${unavailable
            .map((exercise) => starterExercise(exercise)?.name_de ?? exercise)
            .join(
              ", ",
            )} ${unavailable.length === 1 ? "ist" : "sind"} mit deinem Trainingsort und deinen Geräten nicht möglich und ${unavailable.length === 1 ? "wird" : "werden"} nur eingeplant, wenn es eine Alternative gibt.`,
          field: "training.preferred_exercise_ids",
          step: "profile",
        }),
      );
  }

  if (!isPersonComplete(profile))
    found.push(
      issue("recommendation", {
        code: "PERSON_INCOMPLETE",
        message:
          "Alter, Geschlecht, Größe und Gewicht sind freiwillig. Mit ihnen kann Arnold Umfang und Übungsauswahl besser anpassen.",
        field: "person",
        step: "profile",
      }),
    );

  return result(found);
}

function result(
  found: OnboardingValidationIssue[],
): OnboardingValidationResult {
  const errors = found.filter((f) => f.severity === "error");
  return {
    valid: errors.length === 0,
    errors,
    warnings: found.filter((f) => f.severity === "warning"),
    recommendations: found.filter((f) => f.severity === "recommendation"),
  };
}

/** Which collection steps already have all of their answers. */
function completedSteps(profile: OnboardingProfile): OnboardingStep[] {
  if (profile.path === null) return [];
  const done: OnboardingStep[] = ["welcome"];
  if (isProfileComplete(profile))
    done.push(profile.path === "own_plan" ? "own_plan" : "profile");
  return done;
}

/**
 * The progress indicator, derived from the answers.
 *
 * Nothing here is stored: a progress field that could disagree with the profile
 * it describes is a bug waiting to happen.
 */
export function buildProgress(
  profile: OnboardingProfile,
  context: {
    step: OnboardingStep;
    can_request_plan: boolean;
    can_confirm_plan: boolean;
  },
): OnboardingProgress {
  const required = requiredFieldsFor(profile.path);
  const missing = missingRequiredFields(profile);
  // The path itself counts as the first answer, so choosing a button moves the
  // bar. The own-plan path has no further questions.
  const total = required.length + (profile.path === null ? 0 : 1);
  const answered = total - missing.length;
  const complete = isProfileComplete(profile);
  // The bar covers the whole setup, not just the questions: answers are the
  // first 70%, the plan and its confirmation the rest.
  const base =
    total === 0 ? 0 : Math.round((answered / Math.max(total, 1)) * 70);
  const tail = context.can_confirm_plan ? 20 : complete ? 10 : 0;
  return {
    current_step: context.step,
    completed_steps: completedSteps(profile),
    answered_required: answered,
    total_required: total,
    profile_complete: complete,
    person_complete: isPersonComplete(profile),
    training_complete: profile.path === "arnold_plan" && missing.length === 0,
    missing_fields: missing,
    percent: Math.min(100, base + tail),
    can_request_plan: context.can_request_plan,
    can_confirm_plan: context.can_confirm_plan,
  };
}

/** The picker tiles for where the user trains, in catalog order. */
export function exerciseChoices(profile: OnboardingProfile): ExerciseChoice[] {
  return exercisesFor(
    profile.training.environment,
    profile.training.equipment ?? [],
  ).map((exercise) => ({
    exercise_id: exercise.exercise_id,
    name_de: exercise.name_de,
    muscle_group: exercise.muscle_group,
    muscle_group_label: MUSCLE_GROUP_LABEL[exercise.muscle_group],
  }));
}

/**
 * How many exercises fit into the stated minutes.
 *
 * A rough budget, not a prescription: roughly eight minutes of working time per
 * exercise including rest, floored at three so even a short session is a real
 * session. It exists so a proposal respects the time the user actually has
 * instead of planning ten exercises into 30 minutes.
 */
export function exerciseBudget(minutes: number): { min: number; max: number } {
  const max = Math.max(3, Math.min(10, Math.floor(minutes / 8)));
  return { min: Math.max(2, max - 2), max };
}

/**
 * The brief.
 *
 * Everything a plan proposal needs. The `constraints` and `must_not_invent`
 * lists are written for a model to follow literally, because they are the
 * difference between a plausible plan and a fabricated one: unknown loads stay
 * empty, exercise ids come from the catalog, and the day count matches what
 * the user said.
 */
export function buildBrief(
  profile: OnboardingProfile,
  input: {
    onboarding_session_id: string;
    exercises: readonly ArnoldExercise[];
    now: string;
  },
): OnboardingBrief {
  // Guarded by the caller: a brief is only built for a complete profile.
  if (!isProfileComplete(profile) || profile.path === null)
    throw new Error("Brief setzt ein vollständiges Profil voraus.");

  const person = profile.person;
  const training = profile.training;
  const catalog = input.exercises.filter(
    (exercise) => exercise.status === "active",
  );
  const inCatalog = new Set(catalog.map((exercise) => exercise.exercise_id));
  const reference = (exercise_id: string) => ({
    exercise_id,
    name_de: starterExercise(exercise_id)?.name_de ?? exercise_id,
    in_catalog: inCatalog.has(exercise_id),
  });
  const preferred = (training.preferred_exercise_ids ?? []).map(reference);
  const avoided = (training.avoided_exercise_ids ?? []).map(reference);
  const protect = person.protect_areas ?? [];

  // Free text is collected separately and labelled, so a model treats it as a
  // preference the user expressed and not as an instruction to the server.
  const statements: { field: string; text: string }[] = [];
  if (training.notes)
    statements.push({ field: "training.notes", text: training.notes });

  const runs = wantsRunning(training);
  const mobility =
    training.mobility?.wants === true ? training.mobility : undefined;
  const shared = [
    "Jede Trainingseinheit braucht mindestens eine Übung.",
    "Nur exercise_id-Werte aus exercise_catalog verwenden.",
    "Satzanzahl zwischen 1 und 20, Wiederholungsbereich mit rep_min <= rep_max und beides zwischen 1 und 100.",
    runs
      ? "Der Vorschlag enthält nur den Kraftanteil. Keine Ernährung, keine medizinischen Hinweise. Laufen kommt nicht als Übung hinein, sondern als Laufeinheit (siehe unten)."
      : "Ausschließlich Krafttraining. Kein Cardio, keine Ernährung, keine medizinischen Hinweise.",
  ];
  if (protect.length)
    shared.push(
      `Der Nutzer möchte diese Bereiche schonen: ${protect.map((area) => BODY_AREA_LABEL[area]).join(", ")}. Übungen, die diese Bereiche stark belasten, zurückhaltend einsetzen oder durch schonendere Varianten ersetzen. Das ist eine Trainingsvorliebe, keine Diagnose; keine medizinischen Aussagen dazu machen.`,
    );

  const mobilityBrief = mobility
    ? {
        mobility,
        mobility_catalog: MOBILITY_CATALOG.map((exercise) => ({
          id: exercise.id,
          name_de: exercise.name_de,
          areas: [...exercise.areas],
          mode: exercise.mode,
          per_side: exercise.per_side,
          position: exercise.position,
          morning_ok: exercise.morning_ok,
          default_s: exercise.default_s,
          min_s: exercise.min_s,
          max_s: exercise.max_s,
        })),
      }
    : {};

  const personFacts = {
    age_years: person.age_years ?? null,
    sex: person.sex ?? null,
    height_cm: person.height_cm ?? null,
    body_weight_kg: person.body_weight_kg ?? null,
    protect_areas: protect,
  };

  const base = {
    onboarding_contract: ONBOARDING_CONTRACT as typeof ONBOARDING_CONTRACT,
    onboarding_session_id: input.onboarding_session_id,
    profile_revision: profile.revision,
    person: personFacts,
    focus_muscle_groups: training.focus_muscle_groups ?? [],
    preferred_exercises: preferred,
    avoided_exercises: avoided,
    user_statements: statements,
    exercise_catalog: catalog.map((exercise) => ({
      exercise_id: exercise.exercise_id,
      name_de: exercise.name_de,
      equipment: exercise.equipment,
      primary_muscle: exercise.primary_muscle,
      default_load_basis: exercise.default_load_basis,
      default_execution_mode: exercise.default_execution_mode,
      default_implement_count: exercise.default_implement_count,
    })),
    must_not_invent: [
      "Keine Trainingsgewichte erfinden. target_load_kg nur setzen, wenn der Nutzer das Gewicht genannt hat; sonst weglassen.",
      "Keine Übungs-IDs erfinden. Unbekannte Übungen nicht als gültige exercise_id ausgeben.",
      "Keine Leistungswerte, Maxima oder Fortschritte behaupten, die der Nutzer nicht genannt hat.",
      "Keine medizinischen Aussagen, Diagnosen oder Trainingsfreigaben.",
      "Keine Wirksamkeitsversprechen und keine Behauptung, der Plan sei wissenschaftlich optimal.",
      "Den Plan nicht als aktiviert oder gespeichert darstellen, bevor der Nutzer ihn bestätigt hat.",
    ],
    ...mobilityBrief,
    generated_at_utc: input.now,
  };

  if (profile.path === "own_plan")
    return {
      ...base,
      path: "own_plan",
      task: "Den Trainingsplan übernehmen, den der Nutzer im Chat beschrieben oder als Bild geschickt hat, und mit submit_onboarding_plan_proposal (origin existing_routine) als Entwurf übergeben.",
      goal: null,
      experience: null,
      experience_label: null,
      availability: null,
      environment: null,
      environment_label: null,
      equipment: [],
      split: null,
      constraints: [
        "Den Plan des Nutzers so übernehmen, wie er ist: dieselben Trainingstage, Übungen, Sätze und Wiederholungen. Die Struktur nicht verbessern oder ersetzen.",
        "Fehlt dem Nutzer noch ein Plan im Chat, zuerst darum bitten, ihn als Text einzufügen oder ein Foto davon zu schicken.",
        "Jede genannte Übung der passenden exercise_id aus exercise_catalog zuordnen. Gibt es keine passende Übung, sie nicht weglassen: in custom_exercises mit key (custom:1, custom:2 …) und name_de so beschreiben, wie der Nutzer sie nennt, und in der Einheit key als exercise_id verwenden. Arnold legt sie als eigene Übung an. Gerät, Muskel und Lastbasis nur angeben, wenn eindeutig.",
        "Nicht genannte Sätze oder Wiederholungen nicht erfinden: offen lassen und in open_questions nennen; der Nutzer ergänzt sie im Editor.",
        ...shared,
        ...(mobility ? mobilityConstraints(mobility, true) : []),
      ],
    };

  // Guarded by isProfileComplete: the Arnold path has every required answer.
  const goal = training.primary_goal!;
  const experience = training.experience!;
  const days = training.days_per_week!;
  const minutes = training.session_minutes!;
  const environment = training.environment!;
  const budget = exerciseBudget(minutes);
  const split = training.split ?? "auto";
  const fitting = splitsForDays(days);
  const weekdays = training.training_days ?? [];
  const secondaryGoals = (training.secondary_goals ?? []).filter(
    (g) => g !== goal,
  );

  const constraints = [
    `Genau ${days} Trainingseinheiten pro Woche planen${weekdays.length ? ` (an ${weekdays.map((day) => WEEKDAY_LABEL[day]).join(", ")})` : ""}.`,
    `Jede Einheit soll in etwa ${minutes} Minuten durchführbar sein: ${budget.min} bis ${budget.max} Übungen pro Einheit.`,
    split === "auto"
      ? `Die Aufteilung frei wählen, passend zu ${days} Trainingstagen (sinnvoll: ${fitting
          .filter((option) => option !== "auto")
          .map((option) => SPLIT_LABEL[option])
          .join(
            ", ",
          )}). Jede Muskelgruppe soll mindestens einmal pro Woche trainiert werden.`
      : `Gewünschte Aufteilung: ${SPLIT_LABEL[split]}${fitting.includes(split) ? "" : `. Sie passt nicht ideal zu ${days} Tagen; so umsetzen, dass jede Muskelgruppe trotzdem regelmäßig drankommt`}.`,
    environment === "gym"
      ? "Die volle Geräteauswahl eines Fitnessstudios darf genutzt werden."
      : environment === "mixed"
        ? "Übungen bevorzugen, die sich sowohl im Studio als auch zuhause umsetzen lassen."
        : `Nur Übungen planen, die ${environment === "home" ? "zuhause" : "draußen"} mit ${
            training.equipment?.length
              ? `diesen Geräten möglich sind: ${training.equipment.map((item) => EQUIPMENT_LABEL[item]).join(", ")}${environment === "outdoor" ? ", Klimmzugstange, Barren" : ""}`
              : environment === "outdoor"
                ? "Körpergewicht, Klimmzugstange und Barren möglich sind"
                : "dem eigenen Körpergewicht möglich sind"
          }.`,
    experience === "beginner"
      ? "Für Anfänger: überwiegend Grundübungen, eher wenige Sätze pro Übung (2–3) und leicht erlernbare Varianten."
      : experience === "advanced"
        ? "Für Erfahrene: mehr Trainingsvolumen und gezielte Isolationsübungen sind angemessen."
        : "Für Fortgeschrittene: Grundübungen plus ergänzende Isolationsübungen.",
    ...shared,
  ];
  if (secondaryGoals.length)
    constraints.push(
      `Hauptziel ist ${GOAL_LABEL[goal]}. Zusätzlich gewünscht: ${secondaryGoals.map((g) => GOAL_LABEL[g]).join(", ")}. Diese Ziele mit berücksichtigen, aber dem Hauptziel unterordnen.`,
    );
  if (runs)
    constraints.push(
      "Der Nutzer hat „Ausdauer und Laufen“ gewählt und seine Laufangaben in der Einrichtung gemacht. Sie stehen im Feld running (Ziel, Läufe pro Woche, Minuten pro Woche, längster Lauf, Umfeld, optional Wettkampf, Zielzeit, Referenz) und werden beim Abschluss der Einrichtung ins Laufprofil übernommen. Nicht noch einmal abfragen.",
      "Nach dem Kraftvorschlag Laufeinheiten in denselben Entwurf legen: update_plan_draft mit add_run_session (session_name, run_type, optional preferred_weekday). Anzahl der Läufe = Läufe pro Woche aus dem Laufprofil, im Zweifel eher weniger; höchstens zwei harte Läufe pro Woche. Kraft- und Lauftage so verteilen, dass sie zu den gewählten Trainingstagen passen.",
      "Tempi, Pulszonen, Streckenlängen und Steigerungen nie selbst festlegen oder nennen: Das berechnet Arnold aus dem Laufprofil. Keine Wettkampfzeit versprechen.",
    );
  if (mobility) constraints.push(...mobilityConstraints(mobility, false));
  if (training.focus_muscle_groups?.length)
    constraints.push(
      `Schwerpunkt auf ${training.focus_muscle_groups.map((group) => MUSCLE_GROUP_LABEL[group]).join(", ")}: diese Muskelgruppen etwas häufiger oder mit mehr Sätzen trainieren, ohne die übrigen zu vernachlässigen.`,
    );
  if (preferred.length)
    constraints.push(
      `Diese Übungen bevorzugt einplanen, wenn sie fachlich passen: ${preferred.map((ref) => ref.name_de).join(", ")}.`,
    );
  if (avoided.length)
    constraints.push(
      `Diese Übungen nicht einplanen: ${avoided.map((ref) => ref.name_de).join(", ")}.`,
    );

  return {
    ...base,
    path: "arnold_plan",
    ...(runs && training.run ? { running: training.run } : {}),
    task: "Aus diesen Angaben einen Trainingsplan erstellen und mit submit_onboarding_plan_proposal (origin ai_proposal) als Entwurf übergeben.",
    goal: {
      primary: goal,
      primary_label: GOAL_LABEL[goal],
      secondary: secondaryGoals,
      secondary_labels: secondaryGoals.map((g) => GOAL_LABEL[g]),
    },
    experience,
    experience_label: EXPERIENCE_LABEL[experience],
    availability: {
      days_per_week: days,
      training_days: weekdays,
      session_minutes: minutes,
      suggested_exercises_per_session: budget,
    },
    environment,
    environment_label: ENVIRONMENT_LABEL[environment],
    equipment: training.equipment ?? [],
    split: { preference: split, label: SPLIT_LABEL[split], fitting },
    constraints,
  };
}

/**
 * Checks a proposal against the profile it was built for.
 *
 * Structural validity is the plan service's job; this is the onboarding layer's
 * question: does what came back actually answer what the user asked for? A
 * four-day plan for someone who said three days is a mismatch worth naming even
 * though every row of it is storable.
 */
export function validateProposalAgainstProfile(
  profile: OnboardingProfile,
  sessions: readonly TrainingSessionInputLike[],
): OnboardingValidationResult {
  const found: OnboardingValidationIssue[] = [];

  if (!sessions.length)
    found.push(
      issue("error", {
        code: "PROPOSAL_NO_SESSION",
        message: "Der Planvorschlag enthält keine Trainingseinheit.",
        field: "sessions",
        step: "plan_review",
      }),
    );

  for (const session of sessions)
    if (!session.exercises?.length)
      found.push(
        issue("error", {
          code: "PROPOSAL_EMPTY_SESSION",
          message: `Die Trainingseinheit "${session.session_name}" enthält keine Übung.`,
          field: "sessions",
          step: "plan_review",
        }),
      );

  // The day count is a warning, not an error: the user may well accept a plan
  // that groups their three days differently, and the editor lets them change
  // it. Blocking it here would refuse a plan the user might want. An own plan
  // has no stated day count to compare against.
  const days = profile.training.days_per_week;
  if (
    profile.path === "arnold_plan" &&
    days !== null &&
    sessions.length &&
    sessions.length !== days
  )
    found.push(
      issue("warning", {
        code: "PROPOSAL_DAYS_MISMATCH",
        message: `Der Vorschlag hat ${sessions.length} Trainingseinheiten, gewünscht waren ${days} Trainingstage pro Woche. Im Editor lässt sich das anpassen.`,
        field: "sessions",
        step: "plan_review",
      }),
    );

  if (profile.path === "arnold_plan" && sessions.length)
    found.push(...proposalFitIssues(profile, sessions));

  return result(found);
}

/** The exercise ids a session names; rows without a readable id are skipped. */
function plannedIds(session: TrainingSessionInputLike): string[] {
  const ids: string[] = [];
  for (const row of session.exercises ?? []) {
    const id = (row as { exercise_id?: unknown } | null)?.exercise_id;
    if (typeof id === "string") ids.push(id);
  }
  return ids;
}

const nameOf = (id: string) => starterExercise(id)?.name_de ?? null;
const listOf = (names: readonly string[]) =>
  names.length > 1
    ? `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`
    : names[0];

/**
 * Three checks of a proposal against what the user said about themselves.
 *
 * - An exercise the user wants to avoid is refused (error): it contradicts an
 *   explicit answer.
 * - A starter-catalog exercise that needs equipment the user does not have, and
 *   more exercises than fit into the stated minutes, are only noted (warning):
 *   the user may train elsewhere sometimes or accept a longer session.
 *
 * What the profile does not say is not assumed: no environment (or home and
 * outdoor without any listed equipment) means no equipment finding, and no
 * session length means no time finding. Exercises outside the starter catalog,
 * such as the user's own, are never judged.
 */
export function proposalFitIssues(
  profile: OnboardingProfile,
  sessions: readonly TrainingSessionInputLike[],
): OnboardingValidationIssue[] {
  const found: OnboardingValidationIssue[] = [];
  const training = profile.training;

  const avoided = new Set(training.avoided_exercise_ids ?? []);
  if (avoided.size) {
    const hits = unique(
      sessions.flatMap(plannedIds).filter((id) => avoided.has(id)),
    );
    if (hits.length)
      found.push(
        issue("error", {
          code: "PROPOSAL_AVOIDED_EXERCISE",
          message: `Der Vorschlag enthält ${listOf(hits.map((id) => nameOf(id) ?? "eine Übung, die du vermeiden möchtest"))}, die du ausgeschlossen hast. Bitte einen Vorschlag ohne ${hits.length === 1 ? "diese Übung" : "diese Übungen"} machen.`,
          field: "sessions",
          step: "plan_review",
        }),
      );
  }

  const owned = training.equipment ?? [];
  const equipmentKnown =
    training.environment === "gym" ||
    training.environment === "mixed" ||
    ((training.environment === "home" || training.environment === "outdoor") &&
      owned.length > 0);
  if (equipmentKnown) {
    const possible = new Set(
      exercisesFor(training.environment, owned).map((e) => e.exercise_id),
    );
    const missing = unique(
      sessions
        .flatMap(plannedIds)
        .filter((id) => starterExercise(id) && !possible.has(id)),
    );
    if (missing.length)
      found.push(
        issue("warning", {
          code: "PROPOSAL_EQUIPMENT_MISSING",
          message: `${listOf(missing.map((id) => nameOf(id)!))} ${missing.length === 1 ? "braucht" : "brauchen"} Geräte, die du nicht angegeben hast. Im Editor lässt sich ${missing.length === 1 ? "die Übung" : "das"} ersetzen.`,
          field: "sessions",
          step: "plan_review",
        }),
      );
  }

  const minutes = training.session_minutes;
  if (minutes !== null && minutes !== undefined) {
    const { max } = exerciseBudget(minutes);
    const long = sessions.filter((s) => plannedIds(s).length > max);
    if (long.length)
      found.push(
        issue("warning", {
          code: "PROPOSAL_OVER_TIME_BUDGET",
          message: `${long.length === 1 ? `Die Einheit "${long[0].session_name}" hat` : `Die Einheiten ${listOf(long.map((s) => `"${s.session_name}"`))} haben`} mehr Übungen, als in ${minutes} Minuten sinnvoll Platz haben (höchstens ${max}). Im Editor lässt sich das kürzen.`,
          field: "sessions",
          step: "plan_review",
        }),
      );
  }

  return found;
}

const ordered = <T extends string>(values: readonly T[], order: readonly T[]) =>
  order.filter((value) => values.includes(value));
const unique = <T>(values: readonly T[]) => [...new Set(values)];

/** The rules for mobility in a proposal, written like the run rules. */
function mobilityConstraints(
  mobility: Extract<MobilityPreference, { wants: true }>,
  own: boolean,
): string[] {
  const rules = [
    "Der Nutzer möchte Mobility (Feld mobility und mobility_catalog im Brief) und hat seine Angaben in der Einrichtung gemacht. Nicht noch einmal abfragen.",
    `Mobility kommt erst ${own ? "nach der Planübernahme" : "nach dem Kraftvorschlag"} in denselben Entwurf: update_plan_draft mit add_mobility_session. Nur Übungen aus mobility_catalog verwenden.`,
  ];
  if (mobility.morning)
    rules.push(
      "Die Morgenroutine nur aus Übungen mit morning_ok=true zusammenstellen (im Stehen oder an der Wand).",
    );
  if (mobility.sessions)
    rules.push(
      mobility.sessions.placement === "arnold_decides"
        ? "Mobility-Einheiten: Arnold entscheidet. Einen Tag ohne Krafttraining wählen, sonst nach dem Krafttraining."
        : mobility.sessions.placement === "own_days"
          ? "Mobility-Einheiten kommen an eigene Tage ohne Krafttraining."
          : "Mobility-Einheiten kommen nach dem Krafttraining.",
    );
  if (mobility.stiff_areas.length)
    rules.push(
      `Übungen nach den steifen Bereichen wählen (${mobility.stiff_areas.join(", ")}). Steif ist keine Diagnose; keine medizinischen Aussagen.`,
    );
  rules.push(
    "Sekunden, Haltezeiten und Wiederholungen nie selbst festlegen: Das rechnet Arnold. Keine Diagnosen, keine Heilversprechen.",
  );
  return rules;
}

/**
 * Fills the gaps of a mobility answer with Arnold's defaults.
 *
 * "Yes, a morning routine" without days or length becomes every day, 10
 * minutes; sessions without details become two per week of 20 minutes with
 * Arnold deciding the placement. A "yes" naming neither a routine nor
 * sessions means the morning routine, the lighter reading. Values the user
 * named stay as they are. An answer that is not readable even after this is
 * returned unchanged for the schema to refuse; nothing is guessed.
 */
export function withMobilityDefaults(value: unknown): MobilityPreference {
  const loose = (value ?? {}) as Record<string, unknown>;
  if (loose.wants !== true) return value as MobilityPreference;
  const object = (input: unknown): Record<string, unknown> | null =>
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : null;
  const morning = object(loose.morning);
  const sessions = object(loose.sessions);
  const named = morning !== null || sessions !== null;
  const completed = {
    wants: true,
    morning:
      morning !== null || !named
        ? {
            ...MOBILITY_DEFAULTS.morning,
            weekdays: [...MOBILITY_DEFAULTS.morning.weekdays],
            ...Object.fromEntries(
              Object.entries(morning ?? {}).filter(
                ([, v]) => v !== undefined && v !== null,
              ),
            ),
          }
        : null,
    sessions:
      sessions !== null
        ? {
            placement: "arnold_decides",
            ...MOBILITY_DEFAULTS.sessions,
            ...Object.fromEntries(
              Object.entries(sessions).filter(
                ([, v]) => v !== undefined && v !== null,
              ),
            ),
          }
        : null,
    stiff_areas: Array.isArray(loose.stiff_areas)
      ? unique(loose.stiff_areas as string[])
      : [],
  };
  const parsed = MobilityPreferenceSchema.safeParse(completed);
  return parsed.success ? parsed.data : (value as MobilityPreference);
}

/**
 * Applies a patch to a profile.
 *
 * Absent keys stay, `null` removes an optional answer, an empty list removes
 * a list. Two rules keep the answers consistent instead of contradictory:
 * fixed weekdays decide the number of days, and an exercise is either
 * preferred or avoided, never both — the newer choice wins.
 */
export function mergeProfile(
  before: OnboardingProfile,
  patch: OnboardingProfilePatch,
): Omit<OnboardingProfile, "revision" | "updated_at_utc"> {
  const person: Record<string, unknown> = { ...before.person };
  for (const [key, value] of Object.entries(patch.person ?? {})) {
    if (value === undefined) continue;
    if (value === null || (Array.isArray(value) && value.length === 0))
      delete person[key];
    else person[key] = Array.isArray(value) ? unique(value) : value;
  }

  const training: Record<string, unknown> = { ...before.training };
  for (const [key, value] of Object.entries(patch.training ?? {})) {
    if (value === undefined) continue;
    if (value === null || (Array.isArray(value) && value.length === 0))
      delete training[key];
    else training[key] = Array.isArray(value) ? unique(value) : value;
  }

  // Mobility: what the user did not name gets Arnold's default, what they
  // named is never overwritten. `null` was removed above ("not asked").
  if (patch.training?.mobility)
    training.mobility = withMobilityDefaults(patch.training.mobility);

  const days = patch.training?.training_days;
  if (days?.length) {
    training.training_days = ordered(days, WEEKDAYS);
    training.days_per_week = (training.training_days as unknown[]).length;
  } else if (
    patch.training?.days_per_week !== undefined &&
    Array.isArray(training.training_days) &&
    training.training_days.length !== patch.training.days_per_week
  )
    // "Flexibel, vier Tage" replaces three fixed weekdays.
    delete training.training_days;

  const drop = (key: string, ids: readonly string[] | undefined) => {
    if (!ids?.length || !Array.isArray(training[key])) return;
    const rest = (training[key] as string[]).filter((id) => !ids.includes(id));
    if (rest.length) training[key] = rest;
    else delete training[key];
  };
  // The primary goal is never also a secondary one.
  if (Array.isArray(training.secondary_goals)) {
    const rest = (training.secondary_goals as string[]).filter(
      (g) => g !== training.primary_goal,
    );
    if (rest.length) training.secondary_goals = rest;
    else delete training.secondary_goals;
  }
  drop("avoided_exercise_ids", patch.training?.preferred_exercise_ids);
  drop("preferred_exercise_ids", patch.training?.avoided_exercise_ids);

  return {
    path: patch.path ?? before.path,
    person: person as OnboardingProfile["person"],
    training: training as OnboardingProfile["training"],
  };
}
