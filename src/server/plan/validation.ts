/**
 * Plan validation.
 *
 * Validation answers one question — "may this draft be activated?" — and it
 * answers it in three separable registers, because conflating them would make
 * the product either unusable or untrustworthy:
 *
 *   error          blocks activation. The data would be wrong, ambiguous or
 *                  not representable in the schema.
 *   warning        a real finding the user should see, which does not make the
 *                  plan wrong (a retired exercise, a target the analytics
 *                  engine cannot use).
 *   recommendation training advice. Never blocking. Three training days is not
 *                 a defect, and Arnold does not pretend to know better.
 *
 * A number without its load convention is treated as an *error*, not a
 * warning: "70" that might mean 70 kg total or 70 kg per dumbbell is the one
 * ambiguity this codebase refuses to store.
 */
import {
  ARNOLD_SCHEMA_ID,
  ARNOLD_SCHEMA_VERSION,
  type ArnoldDataset,
  type ArnoldExercise,
} from "../../shared/arnold-schema-v1.js";
import type {
  PlannedExercise,
  PlanValidationIssue,
  PlanValidationResult,
  TrainingPlanVersion,
  TrainingSession,
} from "../../shared/plan-contract.js";
import { findPlan, projectVersion } from "./domain.js";

type Draft = Pick<PlanValidationIssue, "code" | "message"> &
  Partial<PlanValidationIssue>;

function issue(
  severity: PlanValidationIssue["severity"],
  draft: Draft,
): PlanValidationIssue {
  return {
    code: draft.code,
    severity,
    message: draft.message,
    session_id: draft.session_id ?? null,
    plan_item_id: draft.plan_item_id ?? null,
    exercise_id: draft.exercise_id ?? null,
    field: draft.field ?? null,
  };
}

/** Hard numeric bounds. Beyond these a value is a data defect, not a choice. */
const MAX_SETS = 50;
const MAX_REPS = 1000;
const MAX_REST_SECONDS = 86_400;
const MAX_LOAD_KG = 1000;
/**
 * Sensible ceilings, stated in the onboarding brief ("1 bis 20 Sätze, 1 bis
 * 100 Wiederholungen"). Above them the value is almost surely a typo, but a
 * stored plan must not become unusable, so they warn instead of blocking.
 */
const SENSIBLE_SETS = 20;
const SENSIBLE_REPS = 100;

/**
 * Checks one planned exercise in isolation.
 *
 * Exported so the service can reject a single bad edit before it is written,
 * rather than writing it and reporting the problem afterwards.
 */
export function validatePlannedExercise(
  exercise: PlannedExercise,
  catalog: ArnoldExercise | undefined,
): PlanValidationIssue[] {
  const found: PlanValidationIssue[] = [];
  const where = {
    session_id: exercise.session_id,
    plan_item_id: exercise.plan_item_id,
    exercise_id: exercise.exercise_id,
  };
  if (!catalog)
    found.push(
      issue("error", {
        ...where,
        code: "UNKNOWN_EXERCISE",
        message: `Die Übung ${exercise.exercise_id} ist im Übungskatalog nicht vorhanden.`,
        field: "exercise_id",
      }),
    );
  else if (catalog.status !== "active")
    found.push(
      issue("warning", {
        ...where,
        code: "RETIRED_EXERCISE",
        message: `"${catalog.name_de}" ist im Katalog ausgemustert. Der Plan bleibt speicherbar; ein Austausch ist empfehlenswert.`,
        field: "exercise_id",
      }),
    );

  const { target_sets, rep_min, rep_max } = exercise;
  if (
    target_sets !== null &&
    (!Number.isInteger(target_sets) ||
      target_sets < 1 ||
      target_sets > MAX_SETS)
  )
    found.push(
      issue("error", {
        ...where,
        code: "INVALID_SET_COUNT",
        message: `Die Satzanzahl muss eine ganze Zahl zwischen 1 und ${MAX_SETS} sein.`,
        field: "target_sets",
      }),
    );
  if (
    target_sets !== null &&
    Number.isInteger(target_sets) &&
    target_sets > SENSIBLE_SETS &&
    target_sets <= MAX_SETS
  )
    found.push(
      issue("warning", {
        ...where,
        code: "INVALID_SET_COUNT",
        message: `${target_sets} Sätze bei "${exercise.exercise_name}" sind ungewöhnlich viel (üblich sind 2 bis 5, höchstens ${SENSIBLE_SETS}). Bitte prüfen, ob das so gewollt ist.`,
        field: "target_sets",
      }),
    );
  if (target_sets === null)
    found.push(
      issue("warning", {
        ...where,
        code: "MISSING_TARGET_SETS",
        message: `Für "${exercise.exercise_name}" sind keine Zielsätze gesetzt. Die Planeinhaltung lässt sich dafür nicht berechnen.`,
        field: "target_sets",
      }),
    );

  if (rep_min !== null && rep_max !== null && rep_min > rep_max)
    found.push(
      issue("error", {
        ...where,
        code: "INVALID_REP_RANGE",
        message:
          "Das Wiederholungsminimum darf nicht größer als das Maximum sein.",
        field: "rep_max",
      }),
    );
  for (const [field, value] of [
    ["rep_min", rep_min],
    ["rep_max", rep_max],
  ] as const)
    if (
      value !== null &&
      (!Number.isInteger(value) || value < 0 || value > MAX_REPS)
    )
      found.push(
        issue("error", {
          ...where,
          code: "INVALID_REP_RANGE",
          message: `Der Wiederholungswert muss eine ganze Zahl zwischen 0 und ${MAX_REPS} sein.`,
          field,
        }),
      );
  for (const [field, value] of [
    ["rep_min", rep_min],
    ["rep_max", rep_max],
  ] as const)
    if (
      value !== null &&
      Number.isInteger(value) &&
      value > SENSIBLE_REPS &&
      value <= MAX_REPS
    )
      found.push(
        issue("warning", {
          ...where,
          code: "INVALID_REP_RANGE",
          message: `${value} Wiederholungen bei "${exercise.exercise_name}" sind ungewöhnlich viel (höchstens ${SENSIBLE_REPS}). Bitte prüfen, ob das so gewollt ist.`,
          field,
        }),
      );
  if ((rep_min === null) !== (rep_max === null))
    found.push(
      issue("warning", {
        ...where,
        code: "INVALID_REP_RANGE",
        message: `Für "${exercise.exercise_name}" ist nur eine Seite des Wiederholungsbereichs gesetzt.`,
        field: rep_min === null ? "rep_min" : "rep_max",
      }),
    );
  if (rep_min !== null && rep_max !== null && rep_max - rep_min > 10)
    found.push(
      issue("recommendation", {
        ...where,
        code: "WIDE_REP_RANGE",
        message: `Der Wiederholungsbereich ${rep_min}–${rep_max} ist sehr weit. Ein engerer Bereich steuert die Belastung genauer.`,
        field: "rep_max",
      }),
    );

  // A target weight without its convention cannot be interpreted later.
  const { target_load_kg, target_load_basis } = exercise;
  if (target_load_kg !== null && target_load_basis === null)
    found.push(
      issue("error", {
        ...where,
        code: "LOAD_BASIS_MISMATCH",
        message: `Für "${exercise.exercise_name}" fehlt die Gewichtsdefinition. Ein Zielgewicht ohne Angabe wie "gesamt" oder "pro Hantel" ist nicht eindeutig.`,
        field: "target_load_basis",
      }),
    );
  if (
    target_load_kg !== null &&
    (!Number.isFinite(target_load_kg) ||
      target_load_kg < 0 ||
      target_load_kg > MAX_LOAD_KG)
  )
    found.push(
      issue("error", {
        ...where,
        code: "INVALID_TARGET_LOAD",
        message: `Das Zielgewicht muss zwischen 0 und ${MAX_LOAD_KG} kg liegen. Negative Zielgewichte sind nicht zulässig.`,
        field: "target_load_kg",
      }),
    );
  if (
    target_load_basis === "bodyweight_only" &&
    target_load_kg !== null &&
    target_load_kg !== 0
  )
    found.push(
      issue("error", {
        ...where,
        code: "INVALID_TARGET_LOAD",
        message:
          'Bei "Körpergewicht" ist kein Zielgewicht zulässig. Für Zusatzlast die Definition "Zusatzgewicht" verwenden.',
        field: "target_load_kg",
      }),
    );
  if (
    target_load_basis === "assistance" &&
    target_load_kg !== null &&
    target_load_kg <= 0
  )
    found.push(
      issue("error", {
        ...where,
        code: "INVALID_TARGET_LOAD",
        message:
          'Eine Unterstützung benötigt eine positive Angabe; das Vorzeichen liegt in der Definition "Unterstützung".',
        field: "target_load_kg",
      }),
    );
  // The convention must suit the movement. A deviation is allowed but named.
  if (
    catalog &&
    target_load_basis !== null &&
    target_load_basis !== catalog.default_load_basis
  )
    found.push(
      issue("warning", {
        ...where,
        code: "LOAD_BASIS_MISMATCH",
        message: `Die Gewichtsdefinition weicht von der Übungsvariante "${catalog.name_de}" ab. Geplant wird nach einer anderen Konvention als im Katalog hinterlegt.`,
        field: "target_load_basis",
      }),
    );

  const { target_execution_mode, target_implement_count } = exercise;
  if (
    target_execution_mode === "unilateral" &&
    target_implement_count !== null &&
    target_implement_count !== 1
  )
    found.push(
      issue("error", {
        ...where,
        code: "INVALID_EXECUTION",
        message:
          "Eine einseitige Ausführung arbeitet mit genau einem Gerät beziehungsweise einer Hantel.",
        field: "target_implement_count",
      }),
    );
  if (
    target_execution_mode === "alternating" &&
    target_implement_count !== null &&
    target_implement_count > 2
  )
    found.push(
      issue("error", {
        ...where,
        code: "INVALID_EXECUTION",
        message:
          "Eine abwechselnde Ausführung arbeitet mit höchstens zwei Geräten beziehungsweise Hanteln.",
        field: "target_implement_count",
      }),
    );
  if (target_implement_count !== null && target_execution_mode === null)
    found.push(
      issue("warning", {
        ...where,
        code: "INVALID_EXECUTION",
        message: `Für "${exercise.exercise_name}" ist eine Geräteanzahl ohne Ausführungsart gesetzt.`,
        field: "target_execution_mode",
      }),
    );

  if (
    exercise.rest_seconds !== null &&
    (!Number.isInteger(exercise.rest_seconds) ||
      exercise.rest_seconds < 0 ||
      exercise.rest_seconds > MAX_REST_SECONDS)
  )
    found.push(
      issue("error", {
        ...where,
        code: "INVALID_REST",
        message:
          "Die Pausenzeit muss in ganzen Sekunden und innerhalb eines Tages liegen.",
        field: "rest_seconds",
      }),
    );
  return found;
}

/** Structural checks across one session. */
function validateSession(session: TrainingSession): PlanValidationIssue[] {
  const found: PlanValidationIssue[] = [];
  const active = session.exercises.filter((e) => e.status === "active");
  if (!active.length)
    found.push(
      issue("error", {
        session_id: session.session_id,
        code: "EMPTY_SESSION",
        message: `Die Trainingseinheit "${session.session_name}" enthält keine aktive Übung. Eine leere Einheit kann nicht gespeichert werden.`,
      }),
    );
  if (!session.persisted)
    found.push(
      issue("error", {
        session_id: session.session_id,
        code: "UNSUPPORTED_STRUCTURE",
        message: `Die Trainingseinheit "${session.session_name}" ist noch nicht gespeichert, weil sie keine Übung enthält. Füge eine Übung hinzu.`,
      }),
    );

  const orders = new Map<number, number>();
  for (const exercise of active)
    orders.set(
      exercise.exercise_order,
      (orders.get(exercise.exercise_order) ?? 0) + 1,
    );
  for (const [order, count] of orders)
    if (count > 1)
      found.push(
        issue("error", {
          session_id: session.session_id,
          code: "DUPLICATE_EXERCISE_ORDER",
          message: `In "${session.session_name}" ist die Übungsposition ${order} mehrfach belegt. Die Reihenfolge wäre nicht eindeutig.`,
          field: "exercise_order",
        }),
      );

  const seen = new Map<string, PlannedExercise>();
  for (const exercise of active) {
    const previous = seen.get(exercise.exercise_id);
    if (previous)
      found.push(
        issue("warning", {
          session_id: session.session_id,
          plan_item_id: exercise.plan_item_id,
          exercise_id: exercise.exercise_id,
          code: "DUPLICATE_EXERCISE_IN_SESSION",
          message: `"${exercise.exercise_name}" kommt in "${session.session_name}" mehrfach vor. Das ist zulässig, aber oft unbeabsichtigt.`,
        }),
      );
    else seen.set(exercise.exercise_id, exercise);
  }
  return found;
}

/**
 * Findings that only make sense across a whole plan, as one message each so a
 * plan entered without pauses does not drown in one line per exercise. All are
 * warnings: they name something that makes the plan work worse (no progression
 * without a rep range, the watch guessing the pause), never something that makes it wrong.
 */
function planWideHints(
  activeSessions: readonly TrainingSession[],
): PlanValidationIssue[] {
  const found: PlanValidationIssue[] = [];
  const items = activeSessions.flatMap((session) =>
    session.exercises.filter((exercise) => exercise.status === "active"),
  );

  const noRange = items.filter((e) => e.rep_min === null && e.rep_max === null);
  if (noRange.length)
    found.push(
      issue("warning", {
        code: "INVALID_REP_RANGE",
        message: `Bei ${noRange.length} ${noRange.length === 1 ? "Übung" : "Übungen"} fehlt der Wiederholungsbereich (zum Beispiel ${noRange[0].exercise_name}). Ohne Bereich kann Arnold keine Steigerung vorschlagen.`,
        plan_item_id: noRange[0].plan_item_id,
        exercise_id: noRange[0].exercise_id,
        field: "rep_min",
      }),
    );

  const noRest = items.filter((e) => e.rest_seconds === null);
  if (noRest.length)
    found.push(
      issue("warning", {
        code: "INVALID_REST",
        message: `Bei ${noRest.length} ${noRest.length === 1 ? "Übung" : "Übungen"} fehlt die Pause zwischen den Sätzen (zum Beispiel ${noRest[0].exercise_name}). Die Uhr nimmt dann pauschal 120 Sekunden.`,
        plan_item_id: noRest[0].plan_item_id,
        exercise_id: noRest[0].exercise_id,
        field: "rest_seconds",
      }),
    );

  return found;
}

/**
 * Validates a projected version.
 *
 * Takes the projection rather than a dataset so the editor can check a
 * candidate that has not been written yet, and so the service can validate the
 * result of an edit batch inside the same lock it used to build it.
 */
export function validateProjection(
  version: TrainingPlanVersion,
  catalog: ReadonlyMap<string, ArnoldExercise>,
  options: { requireDraft?: boolean } = {},
): PlanValidationResult {
  const found: PlanValidationIssue[] = [];
  if (options.requireDraft !== false && version.status !== "draft")
    found.push(
      issue("error", {
        code: "PLAN_NOT_A_DRAFT",
        message: `Diese Planversion hat den Status "${version.status}" und ist nicht mehr bearbeitbar. Änderungen laufen über eine neue Draft-Version.`,
        field: "status",
      }),
    );

  const sessions = version.sessions;
  const activeSessions = sessions.filter((session) =>
    session.exercises.some((exercise) => exercise.status === "active"),
  );
  // A pure run plan (RUN-008) has run sessions and no strength sessions: that is
  // a complete plan, not an empty one.
  const activeRuns = (version.run_sessions ?? []).filter(
    (session) => session.status === "active",
  );
  if (!sessions.length && !activeRuns.length)
    found.push(
      issue("error", {
        code: "NO_SESSION",
        message:
          "Der Plan enthält keine Trainingseinheit. Ein aktivierbarer Plan braucht mindestens eine Einheit.",
      }),
    );
  else if (!activeSessions.length && !activeRuns.length)
    found.push(
      issue("error", {
        code: "NO_ACTIVE_EXERCISE",
        message:
          "Der Plan enthält keine aktive Übung. Ein aktivierbarer Plan braucht mindestens eine Einheit mit mindestens einer Übung.",
      }),
    );

  // Session order must be unambiguous among the sessions that actually exist.
  // Removed sessions keep their historical order value and are excluded.
  const sessionOrders = new Map<number, string[]>();
  for (const session of activeSessions) {
    const bucket = sessionOrders.get(session.session_order);
    if (bucket) bucket.push(session.session_name);
    else sessionOrders.set(session.session_order, [session.session_name]);
  }
  for (const [order, names] of sessionOrders)
    if (names.length > 1)
      found.push(
        issue("error", {
          code: "DUPLICATE_SESSION_ORDER",
          message: `Die Position ${order} ist mehrfach belegt (${names.join(", ")}). Die Reihenfolge der Trainingstage wäre nicht eindeutig.`,
          field: "session_order",
        }),
      );

  const itemIds = new Map<string, number>();
  for (const session of sessions)
    for (const exercise of session.exercises)
      itemIds.set(
        exercise.plan_item_id,
        (itemIds.get(exercise.plan_item_id) ?? 0) + 1,
      );
  for (const [plan_item_id, count] of itemIds)
    if (count > 1)
      found.push(
        issue("error", {
          plan_item_id,
          code: "DUPLICATE_PLAN_ITEM_ID",
          message: `Die Planposition ${plan_item_id} existiert mehrfach. Planpositions-IDs müssen eindeutig sein.`,
        }),
      );

  for (const session of sessions) {
    found.push(...validateSession(session));
    for (const exercise of session.exercises) {
      if (exercise.status !== "active") continue;
      if (exercise.session_id !== session.session_id)
        found.push(
          issue("error", {
            session_id: session.session_id,
            plan_item_id: exercise.plan_item_id,
            code: "INCONSISTENT_SESSION",
            message:
              "Eine Planposition verweist auf eine andere Trainingseinheit als die, in der sie geführt wird.",
            field: "session_id",
          }),
        );
      found.push(
        ...validatePlannedExercise(exercise, catalog.get(exercise.exercise_id)),
      );
    }
  }

  found.push(...planWideHints(activeSessions));

  // Training guidance, explicitly non-blocking.
  if (
    version.days_per_week !== null &&
    activeSessions.length + activeRuns.length > 0 &&
    version.days_per_week !== activeSessions.length + activeRuns.length
  )
    found.push(
      issue("recommendation", {
        code: "DAYS_PER_WEEK_MISMATCH",
        message: `Der Plan nennt ${version.days_per_week} Trainingstage pro Woche, enthält aber ${activeSessions.length + activeRuns.length} Trainingseinheiten. Beides ist zulässig – etwa bei rotierenden Plänen.`,
        field: "days_per_week",
      }),
    );

  const errors = found.filter((f) => f.severity === "error");
  const warnings = found.filter((f) => f.severity === "warning");
  const recommendations = found.filter((f) => f.severity === "recommendation");
  return {
    valid: errors.length === 0,
    plan_version_id: version.plan_version_id,
    row_revision: version.row_revision,
    status: version.status,
    schema_id: ARNOLD_SCHEMA_ID,
    schema_version: ARNOLD_SCHEMA_VERSION,
    errors,
    warnings,
    recommendations,
    // Only a valid draft may be confirmed. An already active version is not
    // "activatable" again, which keeps a double activation out of the UI.
    activatable: errors.length === 0 && version.status === "draft",
  };
}

/** Validates a stored version by id. */
export function validatePlanVersion(
  dataset: ArnoldDataset,
  planVersionId: string,
  options: { requireDraft?: boolean } = {},
): PlanValidationResult | null {
  const plan = findPlan(dataset, planVersionId);
  if (!plan) return null;
  const catalog = new Map(
    dataset.exercises.map((exercise) => [exercise.exercise_id, exercise]),
  );
  return validateProjection(
    projectVersion(dataset, plan, { includeRemoved: false }),
    catalog,
    options,
  );
}
