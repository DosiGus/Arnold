import { useState } from "react";
import { Check } from "lucide-react";
import {
  EXECUTION_MODE_LABEL,
  LOAD_BASIS_LABEL,
} from "../../../shared/arnold-format";
import type { PlannedExercise } from "../../../shared/plan-contract";
import { PlanDialog } from "./dialog";
import { draftFromExercise, type TargetDraft } from "./targets";

/* ----------------------------------------------------- ExerciseSettingsPanel */

/**
 * The full settings of one planned exercise.
 *
 * Shown as a dialog because these are the rarer decisions; sets, reps and the
 * target weight are also editable inline on the card itself.
 */
export function ExerciseSettingsPanel({
  error,
  exercise,
  busy,
  onSave,
  onClose,
}: {
  exercise: PlannedExercise;
  error?: string;
  busy?: boolean;
  onSave: (draft: TargetDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TargetDraft>(() =>
    draftFromExercise(exercise),
  );
  const set = <K extends keyof TargetDraft>(key: K, value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const bodyweight = draft.target_load_basis === "bodyweight_only";
  return (
    <PlanDialog
      title={exercise.exercise_name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onSave(draft)}
          >
            <Check size={14} aria-hidden="true" />
            {busy ? "Wird gespeichert …" : "Übernehmen"}
          </button>
        </>
      }
    >
      {error && (
        <p className="plan-notice warning" role="alert">
          {error}
        </p>
      )}
      <div className="form-row">
        <label>
          Zielsätze
          <input
            type="number"
            min="1"
            max="50"
            step="1"
            value={draft.target_sets}
            onChange={(event) => set("target_sets", event.target.value)}
          />
        </label>
        <label>
          Pause (Sekunden)
          <input
            type="number"
            min="0"
            step="5"
            value={draft.rest_seconds}
            onChange={(event) => set("rest_seconds", event.target.value)}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Wiederholungen von
          <input
            type="number"
            min="0"
            step="1"
            value={draft.rep_min}
            onChange={(event) => set("rep_min", event.target.value)}
          />
        </label>
        <label>
          Wiederholungen bis
          <input
            type="number"
            min="0"
            step="1"
            value={draft.rep_max}
            onChange={(event) => set("rep_max", event.target.value)}
          />
        </label>
      </div>
      {/* Hints are descriptions, so the accessible name of each field stays
          exactly its label. */}
      <label>
        Gewichtsdefinition
        <select
          value={draft.target_load_basis}
          aria-describedby="load-basis-hint"
          onChange={(event) => set("target_load_basis", event.target.value)}
        >
          <option value="">Keine Angabe</option>
          {Object.entries(LOAD_BASIS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p id="load-basis-hint" className="plan-hint">
        Legt fest, wie das Zielgewicht zu lesen ist – etwa gesamt oder pro
        Hantel.
      </p>
      <label>
        Zielgewicht (kg)
        <input
          type="number"
          min="0"
          step="any"
          value={bodyweight ? "" : draft.target_load_kg}
          disabled={bodyweight}
          aria-describedby="target-load-hint"
          onChange={(event) => set("target_load_kg", event.target.value)}
        />
      </label>
      <p id="target-load-hint" className="plan-hint">
        {bodyweight
          ? 'Bei "Körpergewicht" ist kein Zielgewicht vorgesehen. Für Zusatzlast die Definition "Zusatzgewicht" wählen.'
          : "Optional. Ohne Angabe bleibt das Ziel offen."}
      </p>
      <div className="form-row">
        <label>
          Ausführung
          <select
            value={draft.target_execution_mode}
            onChange={(event) =>
              set("target_execution_mode", event.target.value)
            }
          >
            <option value="">Keine Angabe</option>
            {Object.entries(EXECUTION_MODE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Anzahl Geräte
          <input
            type="number"
            min="1"
            step="1"
            value={draft.target_implement_count}
            onChange={(event) =>
              set("target_implement_count", event.target.value)
            }
          />
        </label>
      </div>
      <label>
        Notiz
        <input
          type="text"
          value={draft.notes}
          placeholder="z. B. langsam ablassen"
          onChange={(event) => set("notes", event.target.value)}
        />
      </label>
    </PlanDialog>
  );
}
