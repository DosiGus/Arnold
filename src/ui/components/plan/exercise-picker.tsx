import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  EXECUTION_MODE_LABEL,
  LOAD_BASIS_LABEL,
} from "../../../shared/arnold-format";
import type { PlanExerciseOption } from "../../../shared/plan-contract";
import { PlanDialog } from "./dialog";

/* ------------------------------------------------------------ ExercisePicker */

/**
 * Catalog search.
 *
 * Deliberately never auto-selects on an ambiguous match: if a name matches
 * several variants, the user picks the variant. Guessing between a barbell and
 * a dumbbell bench press would silently change what the plan prescribes.
 */
export function ExercisePicker({
  exercises,
  title,
  onPick,
  onClose,
  busy,
}: {
  exercises: readonly PlanExerciseOption[];
  title: string;
  onPick: (exercise: PlanExerciseOption) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [query, setQuery] = useState("");
  const normalized = query
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
  const matches = useMemo(
    () =>
      exercises.filter((exercise) =>
        !normalized
          ? true
          : [
              exercise.name_de,
              exercise.name_en ?? "",
              exercise.equipment,
              exercise.primary_muscle,
            ]
              .join(" ")
              .normalize("NFKD")
              .replace(/\p{M}/gu, "")
              .toLowerCase()
              .includes(normalized),
      ),
    [exercises, normalized],
  );
  return (
    <PlanDialog title={title} onClose={onClose}>
      <label>
        Übung suchen
        <input
          type="search"
          value={query}
          placeholder="z. B. Bankdrücken, Kurzhantel, Rücken"
          onChange={(event) => setQuery(event.target.value)}
          aria-describedby="picker-count"
        />
      </label>
      <p id="picker-count" className="plan-hint" role="status">
        {matches.length === 0
          ? "Keine passende Übung gefunden."
          : `${matches.length} ${matches.length === 1 ? "Übung" : "Übungen"} gefunden.`}
      </p>
      <ul className="plan-picker-list">
        {matches.map((exercise) => (
          <li key={exercise.exercise_id}>
            <button
              type="button"
              className="plan-picker-item"
              disabled={busy}
              onClick={() => onPick(exercise)}
            >
              <span className="plan-picker-name">
                <strong>{exercise.name_de}</strong>
                <small>
                  {exercise.primary_muscle} · {exercise.equipment} ·{" "}
                  {LOAD_BASIS_LABEL[exercise.default_load_basis]}
                  {exercise.default_execution_mode !== "bilateral_simultaneous"
                    ? ` · ${EXECUTION_MODE_LABEL[exercise.default_execution_mode]}`
                    : ""}
                </small>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </PlanDialog>
  );
}
