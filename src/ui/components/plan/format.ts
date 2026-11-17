import {
  EXECUTION_MODE_LABEL,
  formatLoad,
  formatNumber,
} from "../../../shared/arnold-format";
import type { PlannedExercise } from "../../../shared/plan-contract";

export const PLAN_STATUS_LABEL = {
  draft: "Entwurf",
  active: "Aktiv",
  archived: "Archiviert",
  temporary: "Anpassung auf Zeit",
} as const;

/**
 * A planned target weight, always with its convention and never bare.
 *
 * The wording comes from `formatLoad`, the one place allowed to turn a load
 * basis into text. Reassembling it here is how "20 kg pro Hantel" would turn
 * into "20 kg kg pro Hantel" — or worse, lose the convention entirely.
 */
export function targetLoadText(exercise: {
  target_load_kg: number | null;
  target_load_basis: PlannedExercise["target_load_basis"];
}): string | null {
  if (exercise.target_load_basis === "bodyweight_only") return "Körpergewicht";
  if (exercise.target_load_kg === null) return null;
  if (exercise.target_load_basis === null)
    return `Ziel ${formatNumber(exercise.target_load_kg, 2)} kg · Gewichtsdefinition fehlt`;
  return `Ziel ${formatLoad({
    load_kg: exercise.target_load_kg,
    load_basis: exercise.target_load_basis,
  })}`;
}

/** The one-line target summary shown under an exercise name. */
export function targetSummary(exercise: PlannedExercise): string {
  const parts: string[] = [];
  if (exercise.target_sets !== null)
    parts.push(
      `${exercise.target_sets} ${exercise.target_sets === 1 ? "Satz" : "Sätze"}`,
    );
  if (exercise.rep_min !== null || exercise.rep_max !== null)
    parts.push(
      exercise.rep_min !== null && exercise.rep_max !== null
        ? exercise.rep_min === exercise.rep_max
          ? `${exercise.rep_min} Wdh.`
          : `${exercise.rep_min}–${exercise.rep_max} Wdh.`
        : `${exercise.rep_min ?? exercise.rep_max} Wdh.`,
    );
  const load = targetLoadText(exercise);
  if (load) parts.push(load);
  if (
    exercise.target_execution_mode &&
    exercise.target_execution_mode !== "bilateral_simultaneous"
  )
    parts.push(EXECUTION_MODE_LABEL[exercise.target_execution_mode]);
  if (exercise.rest_seconds !== null)
    parts.push(`${exercise.rest_seconds} s Pause`);
  return parts.length ? parts.join(" · ") : "Noch keine Zielwerte";
}
