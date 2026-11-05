import { useId, useState } from "react";
import { ArrowLeftRight, ChevronDown, Pencil } from "lucide-react";
import type { ArnoldExercise } from "../../shared/arnold-schema-v1";
import type {
  ProposedExercise,
  SessionProposal,
} from "../../shared/workout-contract";
import { NumberField } from "./workout-editor";
import { Stepper } from "./stepper";
import {
  exerciseSummary,
  isBodyweight,
  missing,
  plannedExercise,
  rounds,
  setRound,
  setUniform,
  similarExercises,
  swapExercise,
  type Draft,
  type DraftExercise,
} from "../workout-draft";

/** What the weight of a load basis means, said in the label. */
const LOAD_LABEL: Record<string, string> = {
  per_implement: "Gewicht je Hantel",
  machine_display: "Gewicht (Anzeige)",
  added: "Zusatzgewicht",
  assistance: "Unterstützung",
};

type Mode = "menu" | "edit" | "swap";

/** What the card does when an exercise is replaced for good. */
export type ReplaceInPlan = (
  planItemId: string,
  exercise: ArnoldExercise,
) => Promise<string | undefined>;

/**
 * "Training starten": the day's exercises, one row each — name on the left,
 * weight and sets × reps on the right. A row opens in place to adjust the
 * values or to switch to a similar exercise, today only or for good. The
 * draft is the only state that is saved; this component never writes.
 */
export function PlanDay({
  proposal,
  draft,
  catalog,
  onChange,
  onReplaceInPlan,
  replacing,
  replacedInPlan,
  disabled,
  readOnly,
}: {
  proposal: SessionProposal;
  draft: Draft;
  catalog: readonly ArnoldExercise[];
  onChange: (next: Draft) => void;
  onReplaceInPlan?: ReplaceInPlan;
  replacing?: boolean;
  /** Exercises just put into the plan, by id, with the one they replaced. */
  replacedInPlan?: Record<string, string>;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  // A day with unknown values opens its first gap, so the user sees at once
  // what is missing. Positions are tracked by index: replacing an exercise in
  // the plan issues new plan item ids for the whole day.
  const firstGap = draft.exercises.findIndex((e) => missing(e).length > 0);
  const [open, setOpen] = useState<number | null>(
    readOnly || firstGap < 0 ? null : firstGap,
  );
  const [mode, setMode] = useState<Mode>("edit");

  // Tapping a row offers both ways; only a gap opens straight to the values.
  const toggle = (index: number) => {
    if (open === index) return setOpen(null);
    setOpen(index);
    setMode("menu");
  };

  return (
    <ul className="ac-day" aria-label="Übungen">
      {proposal.exercises.map((planned, index) => (
        <DayRow
          key={planned.plan_item_id ?? planned.exercise_id}
          index={index}
          planned={planned}
          proposal={proposal}
          draft={draft}
          catalog={catalog}
          onChange={onChange}
          isOpen={open === index}
          mode={mode}
          setMode={setMode}
          onToggle={() => toggle(index)}
          onClose={() => setOpen(null)}
          onReplaceInPlan={onReplaceInPlan}
          replacing={replacing}
          replacedFrom={replacedInPlan?.[planned.exercise_id]}
          disabled={disabled}
          readOnly={readOnly}
        />
      ))}
    </ul>
  );
}

function DayRow({
  index,
  planned,
  proposal,
  draft,
  catalog,
  onChange,
  isOpen,
  mode,
  setMode,
  onToggle,
  onClose,
  onReplaceInPlan,
  replacing,
  replacedFrom,
  disabled,
  readOnly,
}: {
  index: number;
  planned: ProposedExercise;
  proposal: SessionProposal;
  draft: Draft;
  catalog: readonly ArnoldExercise[];
  onChange: (next: Draft) => void;
  isOpen: boolean;
  mode: Mode;
  setMode: (mode: Mode) => void;
  onToggle: () => void;
  onClose: () => void;
  onReplaceInPlan?: ReplaceInPlan;
  replacing?: boolean;
  replacedFrom?: string;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const panelId = useId();
  const itemId = planned.plan_item_id;
  const exercise = draft.exercises.find((e) => e.plan_item_id === itemId);
  const skipped = draft.skipped.find((s) => s.plan_item_id === itemId);
  const fresh = itemId ? plannedExercise(proposal, itemId) : undefined;

  const update = (next: DraftExercise) =>
    onChange({
      ...draft,
      exercises: draft.exercises.map((e) =>
        e.plan_item_id === itemId ? next : e,
      ),
    });
  const reset = () => {
    if (!fresh || !itemId) return;
    const others = draft.exercises.filter((e) => e.plan_item_id !== itemId);
    // Back into plan order.
    const exercises = proposal.exercises.flatMap((p) =>
      p.plan_item_id === itemId
        ? [fresh]
        : others.filter((e) => e.plan_item_id === p.plan_item_id),
    );
    onChange({
      exercises: [...exercises, ...others.filter((e) => !e.plan_item_id)],
      skipped: draft.skipped.filter((s) => s.plan_item_id !== itemId),
    });
  };
  const skip = () => {
    if (!itemId || !exercise) return;
    onChange({
      exercises: draft.exercises.filter((e) => e.plan_item_id !== itemId),
      skipped: [
        ...draft.skipped,
        { plan_item_id: itemId, exercise_name: planned.exercise_name },
      ],
    });
    onClose();
  };

  const shown = exercise ?? fresh;
  const summary = shown ? exerciseSummary(shown) : undefined;
  const swapped = exercise && exercise.exercise_id !== planned.exercise_id;
  const edited =
    !!exercise &&
    !swapped &&
    !!fresh &&
    JSON.stringify(exercise.sets) !== JSON.stringify(fresh.sets);
  const tag = skipped
    ? "Heute ausgelassen"
    : swapped
      ? `Nur heute · statt ${planned.exercise_name}`
      : replacedFrom
        ? `Im Plan · ersetzt ${replacedFrom}`
        : edited
          ? "Heute angepasst"
          : undefined;
  const name = skipped
    ? planned.exercise_name
    : (exercise?.exercise_name ?? planned.exercise_name);

  return (
    <li
      className="ac-day-row"
      data-open={isOpen || undefined}
      data-skipped={skipped ? true : undefined}
    >
      <button
        type="button"
        className="ac-day-head"
        aria-expanded={readOnly ? undefined : isOpen}
        aria-controls={isOpen ? panelId : undefined}
        disabled={readOnly}
        onClick={onToggle}
      >
        <span className="ac-day-name">
          <span>{name}</span>
          {tag && <span className="ac-day-tag">{tag}</span>}
        </span>
        {!skipped && summary && (
          <span className="ac-day-values">
            <strong
              data-missing={summary.load === "Gewicht fehlt" || undefined}
            >
              {summary.load}
            </strong>
            <span data-missing={summary.volume.includes("?") || undefined}>
              {summary.volume}
            </span>
          </span>
        )}
        {!readOnly && (
          <span className="ac-day-chev" aria-hidden="true">
            <ChevronDown size={18} />
          </span>
        )}
      </button>
      {isOpen && !readOnly && (
        <div className="ac-day-panel" id={panelId}>
          {skipped || !exercise ? (
            <div className="ac-day-bar">
              <span />
              <button
                type="button"
                className="ac-day-mini"
                disabled={disabled}
                onClick={reset}
              >
                Wieder aufnehmen
              </button>
            </div>
          ) : (
            <>
              {mode === "menu" ? (
                <div className="ac-day-acts">
                  <button
                    type="button"
                    className="ac-day-act"
                    disabled={disabled}
                    onClick={() => setMode("edit")}
                  >
                    <Pencil size={16} aria-hidden="true" />
                    Anpassen
                  </button>
                  <button
                    type="button"
                    className="ac-day-act"
                    disabled={disabled}
                    onClick={() => setMode("swap")}
                  >
                    <ArrowLeftRight size={16} aria-hidden="true" />
                    Wechseln
                  </button>
                </div>
              ) : mode === "edit" ? (
                <Values
                  key={`${index}-${exercise.exercise_id}`}
                  exercise={exercise}
                  onChange={update}
                  disabled={disabled}
                />
              ) : (
                <Swap
                  exercise={exercise}
                  catalog={catalog}
                  taken={draft.exercises.map((e) => e.exercise_id)}
                  canKeep={!!onReplaceInPlan && !!itemId}
                  replacing={replacing}
                  disabled={disabled}
                  onToday={(next) => {
                    const swappedIn = swapExercise(exercise, next);
                    update(swappedIn);
                    if (missing(swappedIn).length) setMode("edit");
                    else onClose();
                  }}
                  onKeep={async (next) => {
                    if (!onReplaceInPlan || !itemId) return undefined;
                    const error = await onReplaceInPlan(itemId, next);
                    if (!error) setMode("edit");
                    return error;
                  }}
                />
              )}
              <div className="ac-day-bar">
                <span className="ac-day-links">
                  {(swapped || edited) && (
                    <button
                      type="button"
                      className="ac-day-link"
                      disabled={disabled}
                      onClick={reset}
                    >
                      Zurücksetzen
                    </button>
                  )}
                  <button
                    type="button"
                    className="ac-day-link"
                    disabled={disabled}
                    onClick={skip}
                  >
                    Heute auslassen
                  </button>
                </span>
                <button type="button" className="ac-day-mini" onClick={onClose}>
                  Fertig
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** "Anpassen": sets, reps and weight of one exercise. */
function Values({
  exercise,
  onChange,
  disabled,
}: {
  exercise: DraftExercise;
  onChange: (next: DraftExercise) => void;
  disabled?: boolean;
}) {
  const c = exercise.conventions;
  const bodyweight = isBodyweight(c);
  const unit = "kg";
  const loadLabel = LOAD_LABEL[c.load_basis] ?? "Gewicht";
  const perSide = c.reps_basis === "per_side";
  const all = rounds(exercise);
  const first = exercise.sets[0];
  const step = c.load_basis === "per_implement" ? 1 : 2.5;
  const reps = first && first.reps > 0 ? first.reps : null;
  const load = first?.load_kg ?? null;
  const repsLabel = perSide ? "Wdh. je Seite" : "Wiederholungen";

  if (exercise.each)
    return (
      <div className="ac-day-values-edit">
        <Stepper
          label="Sätze"
          disabled={disabled}
          minusDisabled={all.length <= 1}
          onMinus={() =>
            onChange({
              ...exercise,
              sets: exercise.sets.slice(
                0,
                exercise.sets.length - exercise.sets.length / all.length,
              ),
            })
          }
          onPlus={() =>
            onChange({
              ...exercise,
              sets: [...exercise.sets, ...all[all.length - 1]],
            })
          }
        >
          <output className="ac-day-count" aria-live="polite">
            {all.length}
          </output>
        </Stepper>
        <ol className="ac-day-sets">
          {all.map((round, index) => (
            <li key={index}>
              <span className="ac-day-step-label">Satz {index + 1}</span>
              <NumberField
                hideLabel
                label={`Satz ${index + 1} ${repsLabel}`}
                unit="Wdh."
                value={round[0].reps > 0 ? round[0].reps : null}
                decimals={0}
                disabled={disabled}
                onChange={(value) =>
                  onChange(setRound(exercise, index, { reps: value ?? 0 }))
                }
              />
              {!bodyweight && (
                <NumberField
                  hideLabel
                  label={`Satz ${index + 1} ${loadLabel}`}
                  unit={unit}
                  value={round[0].load_kg}
                  decimals={2}
                  disabled={disabled}
                  onChange={(value) =>
                    onChange(setRound(exercise, index, { load_kg: value }))
                  }
                />
              )}
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="ac-day-link"
          disabled={disabled}
          onClick={() => onChange(setUniform({ ...exercise, each: false }, {}))}
        >
          Alle Sätze gleich
        </button>
      </div>
    );

  return (
    <div className="ac-day-values-edit">
      <Stepper
        label="Sätze"
        disabled={disabled}
        minusDisabled={all.length <= 1}
        onMinus={() =>
          onChange(setUniform(exercise, { count: all.length - 1 }))
        }
        onPlus={() =>
          onChange(
            setUniform(exercise, { count: Math.min(20, all.length + 1) }),
          )
        }
      >
        <output className="ac-day-count" aria-live="polite">
          {all.length}
        </output>
      </Stepper>
      <Stepper
        label={repsLabel}
        disabled={disabled}
        minusDisabled={!reps || reps <= 1}
        onMinus={() =>
          onChange(setUniform(exercise, { reps: Math.max(1, (reps ?? 1) - 1) }))
        }
        onPlus={() => onChange(setUniform(exercise, { reps: (reps ?? 0) + 1 }))}
      >
        <NumberField
          hideLabel
          label={repsLabel}
          value={reps}
          decimals={0}
          disabled={disabled}
          onChange={(value) =>
            onChange(setUniform(exercise, { reps: value ?? 0 }))
          }
        />
      </Stepper>
      {bodyweight ? (
        <div className="ac-day-step">
          <span className="ac-day-step-label">Gewicht</span>
          <span className="ac-day-step-static">Körpergewicht</span>
        </div>
      ) : (
        <Stepper
          label={loadLabel}
          disabled={disabled}
          minusDisabled={load === null || load <= 0}
          onMinus={() =>
            onChange(
              setUniform(exercise, {
                load_kg: Math.max(
                  0,
                  Math.round(((load ?? 0) - step) * 100) / 100,
                ),
              }),
            )
          }
          onPlus={() =>
            onChange(
              setUniform(exercise, {
                load_kg: Math.round(((load ?? 0) + step) * 100) / 100,
              }),
            )
          }
        >
          <NumberField
            hideLabel
            label={loadLabel}
            unit={unit}
            value={load}
            decimals={2}
            disabled={disabled}
            onChange={(value) =>
              onChange(setUniform(exercise, { load_kg: value }))
            }
          />
        </Stepper>
      )}
      {all.length > 1 && (
        <button
          type="button"
          className="ac-day-link"
          disabled={disabled}
          onClick={() => onChange({ ...exercise, each: true })}
        >
          Sätze einzeln
        </button>
      )}
    </div>
  );
}

/**
 * "Wechseln": similar exercises for the same muscle group first, any other
 * from the catalog below. A pick then asks: today only, or for good.
 */
function Swap({
  exercise,
  catalog,
  taken,
  canKeep,
  replacing,
  disabled,
  onToday,
  onKeep,
}: {
  exercise: DraftExercise;
  catalog: readonly ArnoldExercise[];
  /** Exercises already on today's list: not offered a second time. */
  taken: readonly string[];
  canKeep: boolean;
  replacing?: boolean;
  disabled?: boolean;
  onToday: (next: ArnoldExercise) => void;
  onKeep: (next: ArnoldExercise) => Promise<string | undefined>;
}) {
  const [pick, setPick] = useState<ArnoldExercise>();
  const [error, setError] = useState<string>();
  const selectId = useId();
  const similar = similarExercises(catalog, exercise.exercise_id)
    .filter((e) => !taken.includes(e.exercise_id))
    .slice(0, 6);
  const others = catalog
    .filter(
      (e) =>
        e.status === "active" &&
        e.exercise_id !== exercise.exercise_id &&
        !taken.includes(e.exercise_id) &&
        !similar.some((s) => s.exercise_id === e.exercise_id),
    )
    .sort((a, b) => a.name_de.localeCompare(b.name_de, "de"));
  const muscle = catalog
    .find((e) => e.exercise_id === exercise.exercise_id)
    ?.primary_muscle.trim();
  const choose = (next: ArnoldExercise) => {
    setError(undefined);
    setPick(next);
  };
  const busy = disabled || replacing;

  return (
    <div className="ac-day-swap">
      {similar.length > 0 && (
        <>
          <span className="ac-day-caption">
            Ähnliche Übungen{muscle ? ` · ${muscle}` : ""}
          </span>
          <div className="ac-day-alts">
            {similar.map((e) => (
              <button
                key={e.exercise_id}
                type="button"
                className="ac-day-alt"
                aria-pressed={pick?.exercise_id === e.exercise_id}
                disabled={busy}
                onClick={() => choose(e)}
              >
                <strong>{e.name_de}</strong>
                <small>{e.equipment}</small>
              </button>
            ))}
          </div>
        </>
      )}
      {others.length > 0 && (
        <span className="ac-day-other">
          <label htmlFor={selectId} className="visually-hidden">
            Andere Übung wählen
          </label>
          <select
            id={selectId}
            className="ac-select"
            value={
              pick && !similar.some((s) => s.exercise_id === pick.exercise_id)
                ? pick.exercise_id
                : ""
            }
            disabled={busy}
            onChange={(event) => {
              const next = others.find(
                (e) => e.exercise_id === event.target.value,
              );
              if (next) choose(next);
            }}
          >
            <option value="" disabled>
              {similar.length ? "Andere Übung …" : "Übung wählen …"}
            </option>
            {others.map((e) => (
              <option key={e.exercise_id} value={e.exercise_id}>
                {e.name_de}
              </option>
            ))}
          </select>
        </span>
      )}
      {pick && (
        <div className="ac-day-scope">
          <p className="ac-day-ask">
            {exercise.exercise_name} → <strong>{pick.name_de}</strong>
          </p>
          <div className="ac-day-scope-buttons">
            <button
              type="button"
              className="ac-day-opt primary"
              disabled={busy}
              onClick={() => onToday(pick)}
            >
              Nur heute
            </button>
            {canKeep && (
              <button
                type="button"
                className="ac-day-opt"
                disabled={busy}
                onClick={() =>
                  void onKeep(pick).then((message) => {
                    setError(message);
                    if (!message) setPick(undefined);
                  })
                }
              >
                {replacing ? "Wird geändert …" : "Dauerhaft im Plan"}
              </button>
            )}
          </div>
          {error && (
            <p className="ac-day-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
