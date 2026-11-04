import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Info,
  Pencil,
  Replace,
  Settings2,
  Trash2,
} from "lucide-react";
import { LOAD_BASIS_LABEL } from "../../../shared/arnold-format";
import type {
  PlannedExercise,
  PlanValidationIssue,
} from "../../../shared/plan-contract";
import { IconButton } from "./dialog";
import { targetSummary } from "./format";
import { draftFromExercise, type TargetDraft } from "./targets";

/* -------------------------------------------------------- PlannedExerciseRow */

export type ExerciseRowActions = {
  onMove: (direction: -1 | 1) => void;
  onReplace: () => void;
  onRemove: () => void;
  onSettings: () => void;
  onQuickSave: (draft: TargetDraft) => void;
};

/**
 * One exercise inside a session card.
 *
 * Read-only in overview mode. In edit mode the common decisions (sets, reps,
 * target weight) open inline on the card, so the frequent edits need no dialog
 * and no page change.
 */
export function PlannedExerciseRow({
  exercise,
  position,
  total,
  editable,
  busy,
  issues,
  actions,
}: {
  exercise: PlannedExercise;
  position: number;
  total: number;
  editable: boolean;
  busy?: boolean;
  issues?: readonly PlanValidationIssue[];
  actions?: ExerciseRowActions;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TargetDraft>(() =>
    draftFromExercise(exercise),
  );
  useEffect(() => setDraft(draftFromExercise(exercise)), [exercise]);
  const blocking = (issues ?? []).filter((issue) => issue.severity === "error");
  const advisory = (issues ?? []).filter((issue) => issue.severity !== "error");
  const bodyweight = draft.target_load_basis === "bodyweight_only";
  return (
    <li className={`plan-exercise ${blocking.length ? "has-error" : ""}`}>
      <div className="plan-exercise-main">
        <span className="plan-exercise-index" aria-hidden="true">
          {position}
        </span>
        <div className="plan-exercise-text">
          <strong>
            {exercise.exercise_name}
            {!exercise.exercise_active && (
              <span className="plan-tag warning">Ausgemustert</span>
            )}
          </strong>
          <small>{targetSummary(exercise)}</small>
          {blocking.map((issue) => (
            <small
              key={issue.code + issue.field}
              className="plan-issue error"
              role="alert"
            >
              <AlertTriangle size={12} aria-hidden="true" /> {issue.message}
            </small>
          ))}
          {advisory.map((issue) => (
            <small key={issue.code + issue.field} className="plan-issue">
              <Info size={12} aria-hidden="true" /> {issue.message}
            </small>
          ))}
        </div>
        {editable && actions && (
          <div className="plan-exercise-actions">
            <IconButton
              label={`${exercise.exercise_name} nach oben verschieben`}
              icon={ArrowUp}
              disabled={busy || position === 1}
              onClick={() => actions.onMove(-1)}
            />
            <IconButton
              label={`${exercise.exercise_name} nach unten verschieben`}
              icon={ArrowDown}
              disabled={busy || position === total}
              onClick={() => actions.onMove(1)}
            />
            <IconButton
              label={`Zielwerte von ${exercise.exercise_name} bearbeiten`}
              icon={Pencil}
              disabled={busy}
              onClick={() => setOpen((value) => !value)}
            />
            <IconButton
              label={`${exercise.exercise_name} austauschen`}
              icon={Replace}
              disabled={busy}
              onClick={actions.onReplace}
            />
            <IconButton
              label={`Weitere Einstellungen für ${exercise.exercise_name}`}
              icon={Settings2}
              disabled={busy}
              onClick={actions.onSettings}
            />
            <IconButton
              label={`${exercise.exercise_name} aus dem Entwurf entfernen`}
              icon={Trash2}
              tone="danger"
              disabled={busy}
              onClick={actions.onRemove}
            />
          </div>
        )}
      </div>
      {editable && actions && open && (
        <form
          className="plan-quick-edit"
          onSubmit={(event) => {
            event.preventDefault();
            actions.onQuickSave(draft);
            setOpen(false);
          }}
        >
          <fieldset disabled={busy}>
            <div className="plan-quick-grid">
              <label>
                Sätze
                <input
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  value={draft.target_sets}
                  onChange={(event) =>
                    setDraft({ ...draft, target_sets: event.target.value })
                  }
                />
              </label>
              <label>
                Wdh. von
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.rep_min}
                  onChange={(event) =>
                    setDraft({ ...draft, rep_min: event.target.value })
                  }
                />
              </label>
              <label>
                Wdh. bis
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.rep_max}
                  onChange={(event) =>
                    setDraft({ ...draft, rep_max: event.target.value })
                  }
                />
              </label>
              <label>
                Zielgewicht (kg)
                <input
                  type="number"
                  min="0"
                  step="any"
                  disabled={bodyweight}
                  value={bodyweight ? "" : draft.target_load_kg}
                  onChange={(event) =>
                    setDraft({ ...draft, target_load_kg: event.target.value })
                  }
                />
              </label>
            </div>
            <p className="plan-hint">
              {bodyweight
                ? "Diese Übung ist auf Körpergewicht eingestellt."
                : `Gewichtsdefinition: ${
                    draft.target_load_basis
                      ? LOAD_BASIS_LABEL[
                          draft.target_load_basis as keyof typeof LOAD_BASIS_LABEL
                        ]
                      : "keine Angabe"
                  }. Geplanter Zielwert, kein geloggtes Gewicht.`}
            </p>
            <div className="plan-quick-actions">
              <button type="submit" className="primary">
                <Check size={14} aria-hidden="true" />
                Zielwerte übernehmen
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setDraft(draftFromExercise(exercise));
                  setOpen(false);
                }}
              >
                Abbrechen
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </li>
  );
}
