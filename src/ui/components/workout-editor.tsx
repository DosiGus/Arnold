import { useId, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { ArnoldExercise } from "../../shared/arnold-schema-v1";
import { formatNumber } from "../format";
import {
  addedExercise,
  exerciseLine,
  isBodyweight,
  missing,
  rounds,
  setRound,
  setUniform,
  swapExercise,
  type Draft,
  type DraftExercise,
} from "../workout-draft";

const LOAD_UNIT: Record<string, string> = {
  per_implement: "kg pro Hantel",
  machine_display: "kg (Anzeige)",
  added: "kg zusätzlich",
  assistance: "kg Hilfe",
};

/** Parses "62,5" as well as "62.5"; empty means unknown. */
function parse(raw: string): number | null | undefined {
  const text = raw.replace(",", ".").trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * A small typed number field. Typing is the fast path in the gym; there are no
 * plus/minus buttons for weight or reps.
 */
export function NumberField({
  label,
  unit,
  value,
  decimals,
  onChange,
  disabled,
  hideLabel,
}: {
  label: string;
  unit?: string;
  value: number | null;
  decimals: number;
  /** Only the first row of a set list shows its column names. */
  hideLabel?: boolean;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  const shown = value === null ? "" : formatNumber(value, decimals);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const id = useId();
  const parsed = parse(text);
  const invalid =
    editing &&
    (parsed === undefined ||
      (decimals === 0 && parsed !== null && !Number.isInteger(parsed)));
  return (
    <label className="ac-num" htmlFor={id}>
      <span className={hideLabel ? "visually-hidden" : "ac-num-label"}>
        {label}
      </span>
      <span className="ac-num-box" data-empty={value === null || undefined}>
        <input
          id={id}
          inputMode={decimals ? "decimal" : "numeric"}
          enterKeyHint="done"
          autoComplete="off"
          value={editing ? text : shown}
          placeholder="–"
          aria-invalid={invalid || undefined}
          disabled={disabled}
          onFocus={(e) => {
            setText(shown);
            setEditing(true);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setText(e.target.value);
            const next = parse(e.target.value);
            if (
              next !== undefined &&
              (decimals > 0 || next === null || Number.isInteger(next))
            )
              onChange(next);
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        {unit && <small>{unit}</small>}
      </span>
    </label>
  );
}

function SetCount({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ac-num" role="group" aria-label="Sätze">
      <span className="ac-num-label">Sätze</span>
      <span className="ac-count">
        <button
          type="button"
          className="ac-round small"
          aria-label="Einen Satz weniger"
          disabled={disabled || value <= 1}
          onClick={() => onChange(value - 1)}
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        <output aria-live="polite">{value}</output>
        <button
          type="button"
          className="ac-round small"
          aria-label="Einen Satz mehr"
          disabled={disabled || value >= 20}
          onClick={() => onChange(value + 1)}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

function ExercisePicker({
  label,
  exercises,
  exclude,
  onPick,
  onCancel,
}: {
  label: string;
  exercises: readonly ArnoldExercise[];
  exclude?: string;
  onPick: (exercise: ArnoldExercise) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const sorted = [...exercises]
    .filter((e) => e.exercise_id !== exclude)
    .sort((a, b) => a.name_de.localeCompare(b.name_de, "de"));
  return (
    <div className="ac-picker">
      <label htmlFor={id} className="ac-num-label">
        {label}
      </label>
      <select
        id={id}
        className="ac-select"
        defaultValue=""
        autoFocus
        onChange={(e) => {
          const next = sorted.find((x) => x.exercise_id === e.target.value);
          if (next) onPick(next);
        }}
      >
        <option value="" disabled>
          Übung wählen …
        </option>
        {sorted.map((e) => (
          <option key={e.exercise_id} value={e.exercise_id}>
            {e.name_de}
          </option>
        ))}
      </select>
      <button type="button" className="ac-link" onClick={onCancel}>
        Abbrechen
      </button>
      <p className="ac-caption">
        Nicht dabei? Sag Arnold im Chat, welche Übung du gemacht hast.
      </p>
    </div>
  );
}

function ExerciseEditor({
  exercise,
  catalog,
  onChange,
  onSkip,
  disabled,
}: {
  exercise: DraftExercise;
  catalog: readonly ArnoldExercise[];
  onChange: (next: DraftExercise) => void;
  onSkip: () => void;
  disabled?: boolean;
}) {
  const [swapping, setSwapping] = useState(false);
  const bodyweight = isBodyweight(exercise.conventions);
  const unit = LOAD_UNIT[exercise.conventions.load_basis] ?? "kg";
  const perSide = exercise.conventions.reps_basis === "per_side";
  const all = rounds(exercise);
  const first = exercise.sets[0];
  const gaps = missing(exercise);
  return (
    <li className="ac-edit-ex" data-missing={gaps.length > 0 || undefined}>
      <div className="ac-edit-head">
        <span>
          <strong>{exercise.exercise_name}</strong>
          {exercise.replaces && (
            <span className="ac-caption"> statt {exercise.replaces}</span>
          )}
        </span>
        <span className="ac-edit-tools">
          <button
            type="button"
            className="ac-link"
            disabled={disabled}
            onClick={() => setSwapping((s) => !s)}
          >
            Tauschen
          </button>
          <button
            type="button"
            className="ac-link"
            disabled={disabled}
            onClick={onSkip}
          >
            Weglassen
          </button>
        </span>
      </div>
      {swapping && (
        <ExercisePicker
          label={`Statt ${exercise.exercise_name}`}
          exercises={catalog}
          exclude={exercise.exercise_id}
          onCancel={() => setSwapping(false)}
          onPick={(next) => {
            setSwapping(false);
            onChange(swapExercise(exercise, next));
          }}
        />
      )}
      {!exercise.each ? (
        <div className="ac-edit-grid">
          <SetCount
            value={all.length}
            disabled={disabled}
            onChange={(count) => onChange(setUniform(exercise, { count }))}
          />
          <NumberField
            key={`reps-${exercise.exercise_id}`}
            label={perSide ? "Wdh. je Seite" : "Wdh."}
            value={first && first.reps > 0 ? first.reps : null}
            decimals={0}
            disabled={disabled}
            onChange={(reps) =>
              onChange(setUniform(exercise, { reps: reps ?? 0 }))
            }
          />
          {bodyweight ? (
            <div className="ac-num">
              <span className="ac-num-label">Gewicht</span>
              <span className="ac-num-static">Körper</span>
            </div>
          ) : (
            <NumberField
              key={`load-${exercise.exercise_id}`}
              label="Gewicht"
              unit={unit}
              value={first?.load_kg ?? null}
              decimals={2}
              disabled={disabled}
              onChange={(load_kg) =>
                onChange(setUniform(exercise, { load_kg }))
              }
            />
          )}
        </div>
      ) : (
        <ol className="ac-edit-sets">
          {all.map((round, index) => (
            <li key={index}>
              <span className="ac-num-label">Satz {index + 1}</span>
              <NumberField
                hideLabel={index > 0}
                label={perSide ? "Wdh. je Seite" : "Wdh."}
                value={round[0].reps > 0 ? round[0].reps : null}
                decimals={0}
                disabled={disabled}
                onChange={(reps) =>
                  onChange(setRound(exercise, index, { reps: reps ?? 0 }))
                }
              />
              {!bodyweight && (
                <NumberField
                  hideLabel={index > 0}
                  label="Gewicht"
                  unit={unit}
                  value={round[0].load_kg}
                  decimals={2}
                  disabled={disabled}
                  onChange={(load_kg) =>
                    onChange(setRound(exercise, index, { load_kg }))
                  }
                />
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="ac-edit-foot">
        <span
          className="ac-caption"
          data-warn={gaps.length > 0 || undefined}
          aria-live="polite"
        >
          {gaps.includes("load")
            ? "Gewicht fehlt"
            : gaps.includes("reps")
              ? "Wiederholungen fehlen"
              : exerciseLine(exercise)}
        </span>
        {exercise.each ? (
          <button
            type="button"
            className="ac-link"
            disabled={disabled}
            onClick={() =>
              onChange(setUniform({ ...exercise, each: false }, {}))
            }
          >
            Alle gleich
          </button>
        ) : (
          <button
            type="button"
            className="ac-link"
            disabled={disabled}
            onClick={() => onChange({ ...exercise, each: true })}
          >
            Sätze einzeln
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * "Anpassen": every exercise of the day with its sets, reps and weight, ready
 * to change, swap or leave out. Saving sends the whole draft at once.
 */
export function WorkoutEditor({
  draft,
  catalog,
  onChange,
  restore,
  disabled,
}: {
  draft: Draft;
  catalog: readonly ArnoldExercise[];
  onChange: (next: Draft) => void;
  /** The planned exercise for a plan item that was left out, to bring back. */
  restore: (planItemId: string) => DraftExercise | undefined;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="ac-editor">
      <ul className="ac-edit-list">
        {draft.exercises.map((exercise, index) => (
          <ExerciseEditor
            key={exercise.key}
            exercise={exercise}
            catalog={catalog}
            disabled={disabled}
            onChange={(next) =>
              onChange({
                ...draft,
                exercises: draft.exercises.map((e, i) =>
                  i === index ? next : e,
                ),
              })
            }
            onSkip={() =>
              onChange({
                exercises: draft.exercises.filter((_, i) => i !== index),
                skipped: exercise.plan_item_id
                  ? [
                      ...draft.skipped,
                      {
                        plan_item_id: exercise.plan_item_id,
                        exercise_name:
                          exercise.replaces ?? exercise.exercise_name,
                      },
                    ]
                  : draft.skipped,
              })
            }
          />
        ))}
      </ul>
      {draft.skipped.length > 0 && (
        <ul className="ac-skipped" aria-label="Heute weggelassen">
          {draft.skipped.map((s) => (
            <li key={s.plan_item_id}>
              <span>
                <s>{s.exercise_name}</s> · weggelassen
              </span>
              <button
                type="button"
                className="ac-link"
                disabled={disabled}
                onClick={() => {
                  const back = restore(s.plan_item_id);
                  if (!back) return;
                  onChange({
                    skipped: draft.skipped.filter(
                      (x) => x.plan_item_id !== s.plan_item_id,
                    ),
                    exercises: [...draft.exercises, back],
                  });
                }}
              >
                <RotateCcw size={13} aria-hidden="true" /> Zurückholen
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <ExercisePicker
          label="Übung hinzufügen"
          exercises={catalog}
          onCancel={() => setAdding(false)}
          onPick={(next) => {
            setAdding(false);
            onChange({
              ...draft,
              exercises: [...draft.exercises, addedExercise(next)],
            });
          }}
        />
      ) : (
        <button
          type="button"
          className="ac-link ac-add"
          disabled={disabled}
          onClick={() => setAdding(true)}
        >
          <Plus size={14} aria-hidden="true" /> Übung hinzufügen
        </button>
      )}
    </div>
  );
}
