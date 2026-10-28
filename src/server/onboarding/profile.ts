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
 * Nothing in this module makes a health claim. Physical limitations a user
 * mentions voluntarily stay free text in `preferences.notes`, are passed
 * through as user data, and never become a medical assessment or a training
 * clearance.
 */
import type { ArnoldExercise } from "../../shared/arnold-schema-v1.js";
import {
  ENVIRONMENT_LABEL,
  EXPERIENCE_LABEL,
  FIELD_STEP,
  GOAL_LABEL,
  MISSING_FIELD_CODE,
  ONBOARDING_CONTRACT,
  PROFILE_STEPS,
  REQUIRED_PROFILE_FIELDS,
  REQUIRED_FIELD_LABEL,
  SESSION_MINUTES_MAX,
  SESSION_MINUTES_MIN,
  type OnboardingBrief,
  type OnboardingProfile,
  type OnboardingProgress,
  type OnboardingStep,
  type OnboardingValidationIssue,
  type OnboardingValidationResult,
  type RequiredProfileField,
  type TrainingSessionInputLike,
} from "../../shared/onboarding-contract.js";

/** The required answers that are still missing, in asking order. */
export function missingRequiredFields(
  profile: OnboardingProfile,
): RequiredProfileField[] {
  return REQUIRED_PROFILE_FIELDS.filter((field) => profile[field] === null);
}

export const isProfileComplete = (profile: OnboardingProfile) =>
  missingRequiredFields(profile).length === 0;

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
  catalog: ReadonlyMap<string, ArnoldExercise> = new Map(),
): OnboardingValidationResult {
  const found: OnboardingValidationIssue[] = [];

  for (const field of missingRequiredFields(profile))
    found.push(
      issue("error", {
        code: MISSING_FIELD_CODE[field],
        message: `${REQUIRED_FIELD_LABEL[field]} fehlt noch.`,
        field,
        step: FIELD_STEP[field],
      }),
    );

  // Inside the accepted band, an unusual combination is information, never a
  // refusal. Outside it, the schema has already rejected the value.
  if (profile.session_minutes !== null) {
    if (
      profile.session_minutes < SESSION_MINUTES_MIN ||
      profile.session_minutes > SESSION_MINUTES_MAX
    )
      found.push(
        issue("error", {
          code: "IMPLAUSIBLE_SESSION_MINUTES",
          message: `Die Trainingsdauer sollte zwischen ${SESSION_MINUTES_MIN} und ${SESSION_MINUTES_MAX} Minuten liegen.`,
          field: "session_minutes",
          step: "availability",
        }),
      );
    else if (profile.session_minutes <= 30)
      found.push(
        issue("recommendation", {
          code: "IMPLAUSIBLE_SESSION_MINUTES",
          message:
            "Bei 30 Minuten pro Einheit bleiben wenige Übungen pro Training. Der Plan wird entsprechend kompakt.",
          field: "session_minutes",
          step: "availability",
        }),
      );
  }

  if (profile.days_per_week !== null && profile.days_per_week >= 6)
    found.push(
      issue("recommendation", {
        code: "IMPLAUSIBLE_DAYS_PER_WEEK",
        message:
          "Sechs oder sieben Trainingstage pro Woche lassen wenig Zeit zur Erholung. Das ist möglich, braucht aber eine durchdachte Aufteilung.",
        field: "days_per_week",
        step: "availability",
      }),
    );

  const preferences = profile.preferences;

  // A starting weight without its load convention is not usable: the same
  // number means different things per dumbbell and on a machine display. The
  // schema enforces the fields, so what is left to check is the reference.
  for (const load of preferences.known_starting_loads ?? []) {
    const exercise = catalog.get(load.exercise_id);
    if (!exercise)
      found.push(
        issue("warning", {
          code: "UNKNOWN_EXERCISE_REFERENCE",
          message: `Für das angegebene Startgewicht ist die Übung "${load.exercise_id}" nicht im Übungskatalog. Das Gewicht wird nicht übernommen.`,
          field: "preferences.known_starting_loads",
          step: "preferences",
        }),
      );
    else if (exercise.default_load_basis !== load.load_basis)
      found.push(
        issue("warning", {
          code: "INCOMPLETE_STARTING_LOAD",
          message: `Das Startgewicht für ${exercise.name_de} ist als "${load.load_basis}" angegeben, die Übung wird aber üblicherweise als "${exercise.default_load_basis}" erfasst. Bitte prüfen, damit der Vergleich später stimmt.`,
          field: "preferences.known_starting_loads",
          step: "preferences",
        }),
      );
  }

  // An existing routine is rarely complete. Saying so is more useful than
  // quietly inventing the sets and reps the user never mentioned.
  for (const day of preferences.existing_routine ?? []) {
    if (!day.exercises?.length)
      found.push(
        issue("warning", {
          code: "EXISTING_ROUTINE_INCOMPLETE",
          message: `Für "${day.session_name}" sind noch keine Übungen genannt. Diese Einheit muss vor der Bestätigung ergänzt werden.`,
          field: "preferences.existing_routine",
          step: "preferences",
        }),
      );
    for (const exercise of day.exercises ?? [])
      if (exercise.target_sets === undefined || exercise.rep_min === undefined)
        found.push(
          issue("warning", {
            code: "EXISTING_ROUTINE_INCOMPLETE",
            message: `Für "${exercise.name}" in "${day.session_name}" fehlen Sätze oder Wiederholungen. Offene Angaben bleiben leer und können im Editor ergänzt werden.`,
            field: "preferences.existing_routine",
            step: "preferences",
          }),
        );
  }

  if (
    profile.environment === "home" &&
    (preferences.available_equipment?.length ?? 0) === 0
  )
    found.push(
      issue("recommendation", {
        code: "EQUIPMENT_ENVIRONMENT_MISMATCH",
        message:
          "Für ein Training zuhause hilft es zu wissen, welche Geräte vorhanden sind. Ohne Angabe plant Arnold zurückhaltend.",
        field: "preferences.available_equipment",
        step: "preferences",
      }),
    );

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
  const missing = new Set(
    missingRequiredFields(profile).map((f) => FIELD_STEP[f]),
  );
  const done = PROFILE_STEPS.filter(
    (step) => step !== "summary" && !missing.has(step),
  );
  // The summary is "done" only once every answer behind it is in.
  return missing.size === 0 ? [...done, "summary"] : [...done];
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
  const missing = missingRequiredFields(profile);
  const answered = REQUIRED_PROFILE_FIELDS.length - missing.length;
  const complete = missing.length === 0;
  // The bar covers the whole setup, not just the questions: answers are the
  // first 70%, the plan and its confirmation the rest.
  const base = Math.round((answered / REQUIRED_PROFILE_FIELDS.length) * 70);
  const tail = context.can_confirm_plan ? 20 : complete ? 10 : 0;
  return {
    current_step: context.step,
    completed_steps: completedSteps(profile),
    answered_required: answered,
    total_required: REQUIRED_PROFILE_FIELDS.length,
    profile_complete: complete,
    missing_fields: missing,
    percent: Math.min(100, base + tail),
    can_request_plan: context.can_request_plan,
    can_confirm_plan: context.can_confirm_plan,
  };
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
 * Everything a plan proposal needs and nothing that identifies a person. The
 * `constraints` and `must_not_invent` lists are written for a model to follow
 * literally, because they are the difference between a plausible plan and a
 * fabricated one: unknown loads stay empty, exercise ids come from the catalog,
 * and the day count matches what the user said.
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
  if (
    profile.primary_goal === null ||
    profile.experience === null ||
    profile.days_per_week === null ||
    profile.session_minutes === null ||
    profile.environment === null ||
    profile.starting_point === null
  )
    throw new Error("Brief setzt ein vollständiges Profil voraus.");

  const budget = exerciseBudget(profile.session_minutes);
  const preferences = profile.preferences;

  // Free text is collected separately and labelled, so a model treats it as a
  // preference the user expressed and not as an instruction to the server.
  const statements: { field: string; text: string }[] = [];
  if (preferences.notes)
    statements.push({ field: "preferences.notes", text: preferences.notes });
  for (const day of preferences.existing_routine ?? [])
    for (const exercise of day.exercises ?? [])
      if (exercise.notes)
        statements.push({
          field: `preferences.existing_routine.${day.session_name}.${exercise.name}`,
          text: exercise.notes,
        });

  const constraints = [
    `Genau ${profile.days_per_week} Trainingstage pro Woche planen.`,
    `Jede Einheit soll in etwa ${profile.session_minutes} Minuten durchführbar sein: ${budget.min} bis ${budget.max} Übungen pro Einheit.`,
    "Jede Trainingseinheit braucht mindestens eine Übung.",
    "Nur exercise_id-Werte aus exercise_catalog verwenden.",
    "Satzanzahl zwischen 1 und 20, Wiederholungsbereich mit rep_min <= rep_max und beides zwischen 1 und 100.",
    "Trainingseinheiten frei benennen; es gibt keinen vorgeschriebenen Split.",
    profile.environment === "home"
      ? "Nur Übungen vorschlagen, die mit dem genannten Equipment zuhause durchführbar sind."
      : profile.environment === "mixed"
        ? "Übungen bevorzugen, die sich sowohl im Studio als auch zuhause umsetzen lassen."
        : "Die volle Geräteauswahl eines Fitnessstudios darf genutzt werden.",
    "Ausschließlich Krafttraining. Kein Cardio, keine Ernährung, keine medizinischen Hinweise.",
  ];
  if (preferences.avoided_exercises?.length)
    constraints.push(
      `Diese Übungen meiden: ${preferences.avoided_exercises.join(", ")}.`,
    );
  if (preferences.preferred_exercises?.length)
    constraints.push(
      `Diese Übungen bevorzugt einplanen, wenn sie fachlich passen: ${preferences.preferred_exercises.join(", ")}.`,
    );
  if (preferences.preferred_split)
    constraints.push(
      `Gewünschte Aufteilung, soweit sinnvoll umsetzbar: ${preferences.preferred_split}.`,
    );
  if (profile.starting_point === "existing_plan")
    constraints.push(
      "Die bestehende Routine aus preferences.existing_routine übernehmen und nur fehlende Angaben ergänzen. Die Struktur des Nutzers nicht ohne Not ersetzen.",
    );

  return {
    onboarding_contract: ONBOARDING_CONTRACT,
    onboarding_session_id: input.onboarding_session_id,
    profile_revision: profile.revision,
    goal: {
      primary: profile.primary_goal,
      primary_label: GOAL_LABEL[profile.primary_goal],
      secondary: preferences.secondary_goals ?? [],
    },
    experience: profile.experience,
    experience_label: EXPERIENCE_LABEL[profile.experience],
    availability: {
      days_per_week: profile.days_per_week,
      session_minutes: profile.session_minutes,
      suggested_exercises_per_session: budget,
    },
    environment: profile.environment,
    environment_label: ENVIRONMENT_LABEL[profile.environment],
    starting_point: profile.starting_point,
    preferences,
    user_statements: statements,
    exercise_catalog: input.exercises
      .filter((exercise) => exercise.status === "active")
      .map((exercise) => ({
        exercise_id: exercise.exercise_id,
        name_de: exercise.name_de,
        equipment: exercise.equipment,
        primary_muscle: exercise.primary_muscle,
        default_load_basis: exercise.default_load_basis,
        default_execution_mode: exercise.default_execution_mode,
        default_implement_count: exercise.default_implement_count,
      })),
    constraints,
    must_not_invent: [
      "Keine Trainingsgewichte erfinden. target_load_kg nur setzen, wenn der Nutzer das Gewicht genannt hat; sonst weglassen.",
      "Keine Übungs-IDs erfinden. Unbekannte Übungen nicht als gültige exercise_id ausgeben.",
      "Keine Leistungswerte, Maxima oder Fortschritte behaupten, die der Nutzer nicht genannt hat.",
      "Keine medizinischen Aussagen, Diagnosen oder Trainingsfreigaben.",
      "Keine Wirksamkeitsversprechen und keine Behauptung, der Plan sei wissenschaftlich optimal.",
      "Den Plan nicht als aktiviert oder gespeichert darstellen, bevor der Nutzer ihn bestätigt hat.",
    ],
    generated_at_utc: input.now,
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
  // it. Blocking it here would refuse a plan the user might want.
  if (
    profile.days_per_week !== null &&
    sessions.length &&
    sessions.length !== profile.days_per_week
  )
    found.push(
      issue("warning", {
        code: "PROPOSAL_DAYS_MISMATCH",
        message: `Der Vorschlag hat ${sessions.length} Trainingseinheiten, gewünscht waren ${profile.days_per_week} Trainingstage pro Woche. Im Editor lässt sich das anpassen.`,
        field: "sessions",
        step: "plan_review",
      }),
    );

  const errors = found.filter((f) => f.severity === "error");
  return {
    valid: errors.length === 0,
    errors,
    warnings: found.filter((f) => f.severity === "warning"),
    recommendations: found.filter((f) => f.severity === "recommendation"),
  };
}
