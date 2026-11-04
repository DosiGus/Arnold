import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Info,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  PlannedExercise,
  PlanValidationResult,
  TrainingSession,
} from "../../../shared/plan-contract";
import { IconButton } from "./dialog";
import { PlannedExerciseRow, type ExerciseRowActions } from "./exercise-row";

/* --------------------------------------------------------- TrainingSessionCard */

export type SessionActions = {
  onRename: (name: string) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onAddExercise: () => void;
  exerciseActions: (exercise: PlannedExercise) => ExerciseRowActions;
};

/** One training day. Its name is free text and never derived from a split. */
export function TrainingSessionCard({
  session,
  position,
  total,
  editable,
  busy,
  validation,
  actions,
}: {
  session: TrainingSession;
  position: number;
  total: number;
  editable: boolean;
  busy?: boolean;
  validation?: PlanValidationResult | null;
  actions?: SessionActions;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(session.session_name);
  useEffect(() => setName(session.session_name), [session.session_name]);
  const active = session.exercises.filter(
    (exercise) => exercise.status === "active",
  );
  const issuesFor = (planItemId: string) =>
    [...(validation?.errors ?? []), ...(validation?.warnings ?? [])].filter(
      (issue) => issue.plan_item_id === planItemId,
    );
  const sessionIssues = [
    ...(validation?.errors ?? []),
    ...(validation?.warnings ?? []),
  ].filter(
    (issue) => issue.session_id === session.session_id && !issue.plan_item_id,
  );

  return (
    <section
      className="card plan-session"
      aria-label={`Trainingseinheit ${session.session_name}`}
    >
      <header className="plan-session-head">
        <div className="plan-session-title">
          <span className="plan-session-index" aria-hidden="true">
            {position}
          </span>
          {renaming ? (
            <form
              className="plan-rename"
              onSubmit={(event) => {
                event.preventDefault();
                const trimmed = name.trim();
                if (trimmed && trimmed !== session.session_name)
                  actions?.onRename(trimmed);
                setRenaming(false);
              }}
            >
              <label>
                <span className="visually-hidden">
                  Name der Trainingseinheit
                </span>
                <input
                  value={name}
                  required
                  maxLength={120}
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <button type="submit" className="primary" disabled={busy}>
                <Check size={14} aria-hidden="true" />
                Übernehmen
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setName(session.session_name);
                  setRenaming(false);
                }}
              >
                Abbrechen
              </button>
            </form>
          ) : (
            <div>
              <h2>{session.session_name}</h2>
              <p>
                {active.length} {active.length === 1 ? "Übung" : "Übungen"}
                {session.removed_exercise_count > 0 &&
                  ` · ${session.removed_exercise_count} entfernt`}
                {!session.persisted && (
                  <span className="plan-tag warning">
                    Noch nicht gespeichert
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
        {editable && actions && !renaming && (
          <div className="plan-session-actions">
            <IconButton
              label={`${session.session_name} umbenennen`}
              icon={Pencil}
              disabled={busy}
              onClick={() => setRenaming(true)}
            />
            <IconButton
              label={`${session.session_name} nach oben verschieben`}
              icon={ArrowUp}
              disabled={busy || position === 1 || !session.persisted}
              onClick={() => actions.onMove(-1)}
            />
            <IconButton
              label={`${session.session_name} nach unten verschieben`}
              icon={ArrowDown}
              disabled={busy || position === total || !session.persisted}
              onClick={() => actions.onMove(1)}
            />
            <IconButton
              label={`${session.session_name} duplizieren`}
              icon={Copy}
              disabled={busy || !session.persisted}
              onClick={actions.onDuplicate}
            />
            <IconButton
              label={`${session.session_name} aus dem Entwurf entfernen`}
              icon={Trash2}
              tone="danger"
              disabled={busy}
              onClick={actions.onRemove}
            />
          </div>
        )}
      </header>

      {!session.persisted && (
        <p className="plan-notice info" role="status">
          <Info size={15} aria-hidden="true" />
          <span>Füge eine Übung hinzu, um diese Einheit zu speichern.</span>
        </p>
      )}
      {sessionIssues.map((issue) => (
        <p
          key={issue.code}
          className={`plan-notice ${issue.severity === "error" ? "warning" : "info"}`}
          role={issue.severity === "error" ? "alert" : "status"}
        >
          {issue.severity === "error" ? (
            <AlertTriangle size={15} aria-hidden="true" />
          ) : (
            <Info size={15} aria-hidden="true" />
          )}
          <span>{issue.message}</span>
        </p>
      ))}

      {active.length === 0 ? (
        <p className="plan-empty">Noch keine Übung in dieser Einheit.</p>
      ) : (
        <ol className="plan-exercise-list">
          {active.map((exercise, index) => (
            <PlannedExerciseRow
              key={exercise.plan_item_id}
              exercise={exercise}
              position={index + 1}
              total={active.length}
              editable={editable}
              busy={busy}
              issues={issuesFor(exercise.plan_item_id)}
              actions={actions?.exerciseActions(exercise)}
            />
          ))}
        </ol>
      )}

      {editable && actions && (
        <button
          type="button"
          className="plan-add-button"
          disabled={busy}
          onClick={actions.onAddExercise}
        >
          <Plus size={15} aria-hidden="true" />
          Übung hinzufügen
        </button>
      )}
    </section>
  );
}
