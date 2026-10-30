import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Play, Trophy } from "lucide-react";
import type {
  ArnoldExercise,
  ArnoldPlanItem,
  ArnoldSet,
  ArnoldWorkout,
} from "../../shared/arnold-schema-v1";
import type { ArnoldDashboardView } from "../../shared/arnold-view";
import type { WorkoutContext } from "../../shared/workout-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { useWorkoutLogger } from "../hooks/useWorkoutLogger";
import { useModelContext } from "../hooks/useModelContext";
import {
  finishMessage,
  summaryContext,
  todayContext,
  workoutContext,
} from "../model-context";
import {
  ArnoldCard,
  CardActions,
  CardNote,
  CardSkeleton,
  ChipGroup,
  Rows,
  StatGrid,
  Stepper,
} from "../components/cards";
import {
  dateLabel,
  formatLoad,
  formatNumber,
  formatSetLine,
  UNKNOWN,
} from "../format";
import type { CardId } from "../cards";

type Logger = ReturnType<typeof useWorkoutLogger>;

/**
 * The training card: what is planned today, then one set at a time, then the
 * summary. It is one card that changes its content, so the chat shows a single
 * object for the whole workout instead of a growing stack.
 */
export function TrainingCard({
  client,
  view,
  onChanged,
  onOpen,
}: {
  client: ArnoldMcpClient;
  view: ArnoldDashboardView;
  onChanged: () => void;
  onOpen: (card: CardId) => void;
}) {
  const logger = useWorkoutLogger(client, onChanged);
  const data = logger.data;
  const workout = data?.workout ?? null;
  // Set when the user finishes a workout here, so only that finish is posted
  // to the chat, never one replayed when the chat is reopened.
  const finished = useRef<string | undefined>(undefined);

  // An unfinished workout is continued rather than started a second time.
  const resumed = useRef(false);
  useEffect(() => {
    if (!data || workout || resumed.current || !data.workouts.length) return;
    resumed.current = true;
    const latest = [...data.workouts].sort((a, b) =>
      (b.started_at_utc ?? b.workout_date_local).localeCompare(
        a.started_at_utc ?? a.workout_date_local,
      ),
    )[0];
    void logger.select(latest.workout_id);
  }, [data, workout]);

  if (!data)
    return logger.error ? (
      <ArnoldCard label="Training" title="Training konnte nicht geladen werden">
        <CardNote tone="error">{logger.error}</CardNote>
      </ArnoldCard>
    ) : (
      <CardSkeleton />
    );
  if (!workout && data.workouts.length && !resumed.current)
    return <CardSkeleton />;
  if (workout?.status === "in_progress")
    return (
      <SetLogger
        client={client}
        logger={logger}
        data={data}
        workout={workout}
        onFinish={() => {
          finished.current = workout.workout_id;
        }}
      />
    );
  if (workout?.status === "completed")
    return (
      <SummaryCard
        client={client}
        workout={workout}
        view={view}
        onOpen={onOpen}
        announce={finished.current === workout.workout_id}
        onAnnounced={() => {
          finished.current = undefined;
        }}
      />
    );
  return (
    <TodayCard
      client={client}
      logger={logger}
      data={data}
      view={view}
      onOpen={onOpen}
      cancelled={workout?.status === "cancelled"}
    />
  );
}

/* ------------------------------------------------------------------ today */

const WEEKDAY = new Intl.DateTimeFormat("de-DE", { weekday: "long" });

function localDate() {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

function repRange(item: ArnoldPlanItem) {
  const { rep_min: min, rep_max: max } = item;
  if (min !== null && max !== null)
    return min === max ? `${min}` : `${min}–${max}`;
  return min ?? max ?? null;
}

/** "4 × 6–8 · 75 kg" from the plan's own targets; unknown parts are left out. */
function targetLine(item: ArnoldPlanItem, exercise?: ArnoldExercise) {
  const reps = repRange(item);
  const volume =
    item.target_sets && reps
      ? `${item.target_sets} × ${reps}`
      : item.target_sets
        ? `${item.target_sets} Sätze`
        : reps
          ? `${reps} Wdh.`
          : null;
  const basis = item.target_load_basis ?? exercise?.default_load_basis;
  const load =
    basis === "bodyweight_only"
      ? "Körpergewicht"
      : item.target_load_kg !== null && basis
        ? formatLoad({ load_kg: item.target_load_kg, load_basis: basis })
        : null;
  return [volume, load].filter(Boolean).join(" · ") || UNKNOWN;
}

function sessionItems(
  data: WorkoutContext,
  planVersionId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  if (!planVersionId || !sessionId) return [];
  return data.plan_items
    .filter(
      (item) =>
        item.plan_version_id === planVersionId &&
        item.session_id === sessionId &&
        item.status === "active",
    )
    .sort((a, b) => a.exercise_order - b.exercise_order);
}

function TodayCard({
  client,
  logger,
  data,
  view,
  onOpen,
  cancelled,
}: {
  client: ArnoldMcpClient;
  logger: Logger;
  data: WorkoutContext;
  view: ArnoldDashboardView;
  onOpen: (card: CardId) => void;
  cancelled: boolean;
}) {
  const plan = view.active_plan;
  const sessions = useMemo(
    () =>
      [...(plan?.sessions ?? [])].sort(
        (a, b) => a.session_order - b.session_order,
      ),
    [plan],
  );
  // The day after the most recent workout of this plan comes next.
  const nextIndex = useMemo(() => {
    const last = view.recent_workouts.find(
      (w) =>
        w.plan_version_id === plan?.plan_version_id &&
        w.session_id &&
        w.status === "completed",
    );
    const index = sessions.findIndex((s) => s.session_id === last?.session_id);
    return index < 0 ? 0 : (index + 1) % sessions.length;
  }, [sessions, view.recent_workouts, plan]);
  const [shift, setShift] = useState(0);
  const session = sessions.length
    ? sessions[(nextIndex + shift) % sessions.length]
    : undefined;
  const items = sessionItems(data, plan?.plan_version_id, session?.session_id);
  const exercises = new Map(data.exercises.map((e) => [e.exercise_id, e]));
  const disabled = logger.busy || !!logger.pending;

  const start = () =>
    void logger.write("start_workout", {
      workout_date_local: localDate(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      session_name: session?.session_name ?? "Freies Training",
      ...(plan && session
        ? {
            plan_version_id: plan.plan_version_id,
            session_id: session.session_id,
          }
        : {}),
      source: "ui",
    });

  useModelContext(
    client,
    todayContext({
      sessionName: session?.session_name ?? "Freies Training",
      planName: plan && session ? plan.name : undefined,
      day: session
        ? { order: session.session_order, of: sessions.length }
        : undefined,
      exercises: items.map((item) => ({
        name: exercises.get(item.exercise_id)?.name_de ?? "Übung",
        target: targetLine(item, exercises.get(item.exercise_id)),
      })),
      canWrite: data.can_write,
    }),
  );

  const label = `Heute · ${WEEKDAY.format(new Date())}`;
  const notes = (
    <>
      {cancelled && <CardNote>Das Training wurde abgebrochen.</CardNote>}
      {logger.error && <CardNote tone="error">{logger.error}</CardNote>}
      {logger.pending && (
        <CardNote>
          Der Start ist noch nicht bestätigt. Prüfe ihn, bevor du etwas Neues
          startest.
        </CardNote>
      )}
      {!data.can_write && (
        <CardNote>
          Nur Ansicht: In dieser Verbindung kann Arnold keine Trainings
          speichern.
        </CardNote>
      )}
    </>
  );
  const primary = logger.pending
    ? {
        label: "Erneut prüfen",
        onClick: () => void logger.retry(),
        disabled: logger.busy,
      }
    : data.can_write
      ? {
          label: (
            <>
              <Play size={14} aria-hidden="true" />
              {logger.busy ? "Wird gestartet …" : "Training starten"}
            </>
          ),
          ariaLabel: "Training starten",
          onClick: start,
          disabled,
        }
      : { label: "Überblick", onClick: () => onOpen("week") };

  if (!plan || !session)
    return (
      <ArnoldCard
        label={label}
        title="Freies Training"
        subtitle="Kein aktiver Plan. Du wählst die Übungen beim Eintragen."
      >
        {notes}
        <CardActions
          primary={primary}
          secondary={
            data.can_write
              ? { label: "Überblick", onClick: () => onOpen("week") }
              : undefined
          }
        />
      </ArnoldCard>
    );
  return (
    <ArnoldCard
      label={label}
      aside={
        <span className="ac-label">
          Tag {session.session_order} von {sessions.length}
        </span>
      }
      title={session.session_name}
      subtitle={`${items.length} ${items.length === 1 ? "Übung" : "Übungen"} · ${plan.name}`}
    >
      {items.length > 0 && (
        <Rows
          label="Übungen"
          items={items.map((item) => ({
            key: item.plan_item_id,
            label: exercises.get(item.exercise_id)?.name_de ?? "Übung",
            value: targetLine(item, exercises.get(item.exercise_id)),
          }))}
        />
      )}
      {notes}
      <CardActions
        primary={primary}
        secondary={
          sessions.length > 1
            ? {
                label: "Anderer Tag",
                onClick: () => setShift((s) => s + 1),
                disabled,
              }
            : { label: "Überblick", onClick: () => onOpen("week") }
        }
      />
    </ArnoldCard>
  );
}

/* ------------------------------------------------------------- set logger */

/** How a set felt, stored as reps in reserve. Optional; nothing is guessed. */
const FEEL = [
  { value: "4", label: "Leicht" },
  { value: "2", label: "Passt" },
  { value: "0", label: "Am Limit" },
] as const;
type Feel = (typeof FEEL)[number]["value"];

const SIDES = [
  { value: "left", label: "Links" },
  { value: "right", label: "Rechts" },
] as const;

const LOAD_LABEL: Record<ArnoldSet["load_basis"], string> = {
  total: "Gewicht",
  per_implement: "Gewicht pro Hantel",
  machine_display: "Gewicht laut Anzeige",
  added: "Zusatzgewicht",
  assistance: "Unterstützung",
  bodyweight_only: "Körpergewicht",
};

type Form = {
  weight: number;
  reps: number;
  feel?: Feel;
  warmup: boolean;
  side: ArnoldSet["side"];
};

/** The conventions of a set come from the plan, else from the exercise. */
function conventions(item?: ArnoldPlanItem, exercise?: ArnoldExercise) {
  const execution =
    item?.target_execution_mode ??
    exercise?.default_execution_mode ??
    "bilateral_simultaneous";
  return {
    load_basis:
      item?.target_load_basis ?? exercise?.default_load_basis ?? "total",
    execution_mode: execution,
    implement_count:
      item?.target_implement_count ?? exercise?.default_implement_count ?? 1,
  } as const;
}

function defaultSide(
  execution: ArnoldSet["execution_mode"],
): ArnoldSet["side"] {
  return execution === "unilateral"
    ? "left"
    : execution === "alternating"
      ? "alternating"
      : "both";
}

function SetLogger({
  client,
  logger,
  data,
  workout,
  onFinish,
}: {
  client: ArnoldMcpClient;
  logger: Logger;
  data: WorkoutContext;
  workout: ArnoldWorkout;
  onFinish: () => void;
}) {
  const items = sessionItems(data, workout.plan_version_id, workout.session_id);
  const exercises = new Map(data.exercises.map((e) => [e.exercise_id, e]));
  const sets = data.sets.filter((s) => s.status === "active");
  // A one-sided set is done when both sides are; until then it is one set.
  const workingSets = (id: string) => {
    const working = sets.filter(
      (s) => s.exercise_id === id && s.set_type !== "warmup",
    );
    const side = (name: ArnoldSet["side"]) =>
      working.filter((s) => s.side === name).length;
    return working.some((s) => s.side === "left" || s.side === "right")
      ? Math.min(side("left"), side("right")) +
          side("both") +
          side("alternating")
      : working.length;
  };

  // The plan's exercises in order; without a plan, the catalog, with the
  // exercises already trained today first.
  const options = items.length
    ? items.map((item) => item.exercise_id)
    : [...data.exercises]
        .sort(
          (a, b) =>
            Number(sets.some((s) => s.exercise_id === b.exercise_id)) -
            Number(sets.some((s) => s.exercise_id === a.exercise_id)),
        )
        .map((e) => e.exercise_id);
  const firstOpen =
    items.find(
      (item) => workingSets(item.exercise_id) < (item.target_sets ?? 1),
    )?.exercise_id ??
    sets[sets.length - 1]?.exercise_id ??
    options[0];

  const [exerciseId, setExerciseId] = useState(firstOpen);
  const [edit, setEdit] = useState<ArnoldSet>();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const itemsForExercise = items.filter((i) => i.exercise_id === exerciseId);
  const item = itemsForExercise.length === 1 ? itemsForExercise[0] : undefined;
  const exercise = exerciseId ? exercises.get(exerciseId) : undefined;
  const rules = edit
    ? {
        load_basis: edit.load_basis,
        execution_mode: edit.execution_mode,
        implement_count: edit.implement_count,
      }
    : conventions(item, exercise);

  function prefill(id: string | undefined): Form {
    const last = [...sets].reverse().find((s) => s.exercise_id === id);
    const target = items.find((i) => i.exercise_id === id);
    const rule = conventions(target, id ? exercises.get(id) : undefined);
    return {
      weight: last?.load_kg ?? target?.target_load_kg ?? 0,
      reps: last?.reps ?? target?.rep_max ?? target?.rep_min ?? 8,
      warmup: false,
      side: last?.side ?? defaultSide(rule.execution_mode),
    };
  }
  const [form, setFormState] = useState<Form>(() => prefill(firstOpen));
  // Once the user has changed a value, nothing loaded later overwrites it.
  const touched = useRef(false);
  const setForm = (update: (f: Form) => Form) => {
    touched.current = true;
    setFormState(update);
  };
  const choose = (id: string | undefined) => {
    if (!id) return;
    setExerciseId(id);
    setEdit(undefined);
    touched.current = false;
    setFormState(prefill(id));
  };

  // The last time this exercise was trained, as it was stored: the starting
  // values for its first set today.
  const [previous, setPrevious] = useState<{ line: string; date: string }>();
  useEffect(() => {
    setPrevious(undefined);
    if (!exerciseId) return;
    const basis = rules.load_basis;
    let active = true;
    void client
      .workouts({ exercise_ids: [exerciseId], limit: 1 })
      .then((history) => {
        const earlier = history.workouts.find(
          (w) => w.workout_id !== workout.workout_id,
        );
        const block = earlier?.exercises.find(
          (e) => e.exercise_id === exerciseId,
        );
        const last = block?.sets
          .filter(
            (s) =>
              !s.voided && s.set_type !== "warmup" && s.load_basis === basis,
          )
          .at(-1);
        if (!active || !earlier || !last) return;
        setPrevious({ line: formatSetLine(last), date: earlier.date });
        if (!touched.current && !sets.some((s) => s.exercise_id === exerciseId))
          setFormState((f) => ({
            ...f,
            weight: last.load_kg ?? f.weight,
            reps: last.reps,
          }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [exerciseId]);

  const done = sets.filter((s) => s.exercise_id === exerciseId);
  const doneWorking = exerciseId ? workingSets(exerciseId) : 0;
  const target = item?.target_sets ?? null;
  const disabled = logger.busy || !!logger.pending;
  const bodyweight = rules.load_basis === "bodyweight_only";
  const position = items.findIndex((i) => i.exercise_id === exerciseId);

  useModelContext(
    client,
    workoutContext({
      workout,
      sets: data.sets,
      exercises,
      items,
      current: exerciseId,
      pending: !!logger.pending,
    }),
  );

  async function save() {
    if (!exerciseId) return;
    const fields = {
      set_type: form.warmup
        ? "warmup"
        : edit && edit.set_type !== "warmup"
          ? edit.set_type
          : "working",
      reps: form.reps,
      reps_basis: edit?.reps_basis ?? "total",
      load_kg: bodyweight ? null : form.weight,
      load_basis: rules.load_basis,
      implement_count: rules.implement_count,
      execution_mode: rules.execution_mode,
      side: form.side,
      rpe: edit?.rpe ?? null,
      rir: form.feel === undefined ? (edit?.rir ?? null) : Number(form.feel),
    };
    const response = edit
      ? await logger.write("update_set", {
          set_id: edit.set_id,
          expected_row_revision: edit.row_revision,
          changes: fields,
        })
      : await logger.write("log_workout_sets", {
          workout_id: workout.workout_id,
          sets: [
            {
              ...fields,
              exercise_id: exerciseId,
              plan_item_id: item?.plan_item_id ?? null,
            },
          ],
          source: "ui",
        });
    if (!response?.ok) return;
    setEdit(undefined);
    // After the left side comes the right side; the numbers usually repeat.
    setForm((f) => ({
      ...f,
      feel: undefined,
      warmup: false,
      side: f.side === "left" ? "right" : f.side === "right" ? "left" : f.side,
    }));
  }

  function correct(set: ArnoldSet) {
    setEdit(set);
    setFormState({
      weight: set.load_kg ?? 0,
      reps: set.reps,
      warmup: set.set_type === "warmup",
      side: set.side,
      feel: FEEL.find((f) => Number(f.value) === set.rir)?.value,
    });
  }

  if (confirmCancel)
    return (
      <ArnoldCard
        label={workout.session_name_snapshot}
        title="Training abbrechen?"
        subtitle="Das Training wird als abgebrochen gespeichert und zählt nicht in deine Auswertung."
      >
        {logger.error && <CardNote tone="error">{logger.error}</CardNote>}
        <CardActions
          primary={{
            label: "Ja, abbrechen",
            tone: "danger",
            disabled,
            onClick: () =>
              void logger
                .write("cancel_workout", {
                  workout_id: workout.workout_id,
                  expected_row_revision: workout.row_revision,
                })
                .then(() => setConfirmCancel(false)),
          }}
          secondary={{
            label: "Weiter trainieren",
            onClick: () => setConfirmCancel(false),
          }}
        />
      </ArnoldCard>
    );

  return (
    <ArnoldCard
      label={
        position >= 0
          ? `${workout.session_name_snapshot} · Übung ${position + 1} von ${items.length}`
          : workout.session_name_snapshot
      }
      aside={
        target ? (
          <div
            className="ac-dots"
            role="img"
            aria-label={`${Math.min(doneWorking, target)} von ${target} Sätzen`}
          >
            {Array.from({ length: target }, (_, i) => (
              <i
                key={i}
                className={
                  i < doneWorking ? "done" : i === doneWorking ? "now" : ""
                }
              />
            ))}
          </div>
        ) : (
          <button
            type="button"
            className="ac-link"
            onClick={() => setConfirmCancel(true)}
          >
            Abbrechen
          </button>
        )
      }
      title={exercise?.name_de ?? "Übung wählen"}
      subtitle={
        edit
          ? `Satz ${edit.set_number} korrigieren`
          : target && doneWorking >= target
            ? "Alle geplanten Sätze geschafft"
            : `Satz ${doneWorking + 1}${target ? ` von ${target}` : ""}${item && repRange(item) ? ` · Ziel ${repRange(item)} Wdh.` : ""}`
      }
    >
      {options.length > 1 && (
        <ChipGroup
          label="Übung"
          scroll
          options={options.map((id) => ({
            value: id,
            label: exercises.get(id)?.name_de ?? "Übung",
          }))}
          value={exerciseId}
          onChange={choose}
          disabled={disabled || !!edit}
        />
      )}
      <div className="ac-steppers">
        {!bodyweight && (
          <Stepper
            label={LOAD_LABEL[rules.load_basis]}
            value={form.weight}
            unit="kg"
            step={rules.load_basis === "per_implement" ? 1 : 2.5}
            onChange={(weight) => setForm((f) => ({ ...f, weight }))}
            disabled={disabled}
            format={(v) => formatNumber(v, 2)}
          />
        )}
        <Stepper
          label="Wiederholungen"
          value={form.reps}
          step={1}
          min={1}
          onChange={(reps) => setForm((f) => ({ ...f, reps }))}
          disabled={disabled}
        />
      </div>
      {previous && !edit && (
        <p className="ac-hint">
          Letztes Mal {previous.line} · {dateLabel(previous.date)}
        </p>
      )}
      {rules.execution_mode === "unilateral" && (
        <ChipGroup
          label="Seite"
          options={SIDES}
          value={
            form.side === "left" || form.side === "right"
              ? form.side
              : undefined
          }
          onChange={(side) => side && setForm((f) => ({ ...f, side }))}
          disabled={disabled}
        />
      )}
      <div className="ac-chips">
        <ChipGroup
          label="Wie schwer war der Satz?"
          options={FEEL}
          value={form.feel}
          onChange={(feel) => setForm((f) => ({ ...f, feel }))}
          disabled={disabled}
          allowNone
        />
        <ChipGroup
          label="Satztyp"
          options={[{ value: "warmup", label: "Aufwärmsatz" }] as const}
          value={form.warmup ? "warmup" : undefined}
          onChange={(v) => setForm((f) => ({ ...f, warmup: v === "warmup" }))}
          disabled={disabled}
          allowNone
        />
      </div>
      {done.length > 0 && (
        <div className="ac-chips" role="group" aria-label="Gespeicherte Sätze">
          {done.map((set) => (
            <button
              key={set.set_id}
              type="button"
              className="ac-chip done"
              aria-pressed={edit?.set_id === set.set_id}
              aria-label={`Satz ${set.set_number} korrigieren: ${formatSetLine(set)}`}
              disabled={disabled}
              onClick={() =>
                edit?.set_id === set.set_id ? choose(exerciseId) : correct(set)
              }
            >
              <Check size={12} aria-hidden="true" />
              {set.set_number} · {formatSetLine(set)}
              {set.set_type === "warmup" ? " · Aufwärmen" : ""}
            </button>
          ))}
        </div>
      )}
      {logger.error && <CardNote tone="error">{logger.error}</CardNote>}
      {logger.message && !logger.error && (
        <p className="ac-hint ac-good" role="status">
          <Check size={14} aria-hidden="true" />
          {logger.message}
        </p>
      )}
      {logger.pending ? (
        <>
          <CardNote>
            Die letzte Speicherung ist noch nicht bestätigt. Prüfe sie, bevor du
            weitermachst.
          </CardNote>
          <CardActions
            primary={{
              label: "Erneut prüfen",
              onClick: () => void logger.retry(),
              disabled: logger.busy,
            }}
          />
        </>
      ) : edit ? (
        <CardActions
          primary={{
            label: logger.busy ? "Wird gespeichert …" : "Korrektur speichern",
            onClick: () => void save(),
            disabled,
          }}
          secondary={{
            label: "Satz löschen",
            disabled,
            onClick: () =>
              void logger
                .write("void_set", {
                  set_id: edit.set_id,
                  expected_row_revision: edit.row_revision,
                })
                .then((r) => r?.ok && choose(exerciseId)),
          }}
        />
      ) : (
        <CardActions
          primary={{
            label: logger.busy ? "Wird gespeichert …" : "Satz speichern",
            onClick: () => void save(),
            disabled: disabled || !exerciseId,
          }}
          secondary={{
            label: "Training beenden",
            disabled: disabled || !sets.length,
            onClick: () => {
              onFinish();
              void logger.write("complete_workout", {
                workout_id: workout.workout_id,
                expected_row_revision: workout.row_revision,
              });
            },
          }}
        />
      )}
      {target !== null && !edit && (
        <button
          type="button"
          className="ac-link"
          style={{ justifySelf: "start" }}
          onClick={() => setConfirmCancel(true)}
        >
          Training abbrechen
        </button>
      )}
    </ArnoldCard>
  );
}

/* ---------------------------------------------------------------- summary */

function SummaryCard({
  client,
  workout,
  view,
  onOpen,
  announce,
  onAnnounced,
}: {
  client: ArnoldMcpClient;
  workout: ArnoldWorkout;
  view: ArnoldDashboardView;
  onOpen: (card: CardId) => void;
  /** True right after the user finished this workout in this card. */
  announce: boolean;
  onAnnounced: () => void;
}) {
  // Every number here comes from the analytics engine via the dashboard view;
  // until that has caught up with the save, the card says so instead of
  // counting on its own.
  // Only the summary of the finished workout counts: the view loaded before
  // the finish still lists it as running, with partial numbers.
  const summary = view.recent_workouts.find(
    (w) => w.workout_id === workout.workout_id && w.status === "completed",
  );
  const records = view.records.filter(
    (r) => r.workout_id === workout.workout_id && r.kind === "improvement",
  );
  const record =
    records.find((r) => r.metric === "max_load") ?? records[0] ?? undefined;
  useModelContext(client, summaryContext({ workout, summary, record }));

  // Finishing hands the turn to the chat once, with the engine's numbers. If
  // they do not arrive in time, the message goes without them.
  useEffect(() => {
    if (!announce) return;
    const post = () => {
      onAnnounced();
      void client.askChat(finishMessage({ workout, summary, record }));
    };
    if (summary) {
      post();
      return;
    }
    const timer = setTimeout(post, 4000);
    return () => clearTimeout(timer);
  }, [announce, summary, record]);
  return (
    <ArnoldCard
      label={
        <>
          <Check size={13} aria-hidden="true" />
          Training gespeichert
        </>
      }
      aside={
        <span className="ac-label">
          {dateLabel(workout.workout_date_local)}
        </span>
      }
      title={workout.session_name_snapshot}
    >
      {summary ? (
        <StatGrid
          items={[
            { label: "Übungen", value: summary.exercise_count },
            { label: "Arbeitssätze", value: summary.working_set_count },
            {
              label: "kg Volumen",
              value:
                summary.nominal_volume === null
                  ? UNKNOWN
                  : formatNumber(summary.nominal_volume, 0),
            },
          ]}
        />
      ) : (
        <p className="ac-text">Die Auswertung wird aktualisiert …</p>
      )}
      {record && (
        <div className="ac-highlight">
          <span className="ac-medal">
            <Trophy size={16} aria-hidden="true" />
          </span>
          <span>
            <strong>
              {record.exercise_name} · {formatNumber(record.value, 1)}{" "}
              {record.unit === "reps" ? "Wdh." : record.unit}
            </strong>
            <br />
            <span className="ac-text">
              Neuer Rekord
              {record.improvement !== null && record.improvement > 0
                ? ` · +${formatNumber(record.improvement, 1)} ${record.unit === "reps" ? "Wdh." : record.unit}`
                : ""}
            </span>
          </span>
        </div>
      )}
      <CardActions
        primary={{ label: "Überblick", onClick: () => onOpen("week") }}
        secondary={{ label: "Fortschritt", onClick: () => onOpen("progress") }}
      />
    </ArnoldCard>
  );
}
