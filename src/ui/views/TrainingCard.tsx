import { useEffect, useMemo, useRef, useState } from "react";
import { Check, MoreHorizontal, Play, Trophy } from "lucide-react";
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
import { RecoveryCard, RecoveryNotice } from "../components/recovery";
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
      <RecoveryCard
        recovery={logger.failure?.recovery ?? "retry_same_request"}
        onAction={() => void logger.reload()}
      />
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
        ? `${item.target_sets} ${item.target_sets === 1 ? "Satz" : "Sätze"}`
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
      {logger.error && (
        <RecoveryNotice
          message={logger.failure?.message}
          code={logger.failure?.code}
          recovery={logger.failure?.recovery ?? "retry_same_request"}
          onAction={
            logger.pending
              ? undefined
              : logger.failure?.recovery === "reload_then_retry"
                ? () => void logger.reload()
                : undefined
          }
          busy={logger.busy}
        />
      )}
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

/**
 * How a set felt, stored as reps in reserve. Asked after the set, during the
 * rest, and always optional; nothing is guessed.
 */
const FEEL = [
  { value: "0", label: "Am Limit" },
  { value: "1", label: "1 mehr" },
  { value: "2", label: "2 mehr" },
  { value: "3", label: "3+ mehr" },
] as const;
type Feel = (typeof FEEL)[number]["value"];
const feelOf = (rir: number | null | undefined): Feel | undefined =>
  rir === null || rir === undefined
    ? undefined
    : rir >= 3
      ? "3"
      : FEEL.find((f) => Number(f.value) === rir)?.value;

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

/** Used when the plan names no rest. */
const DEFAULT_REST_SECONDS = 90;

type Form = {
  weight: number;
  weightKnown: boolean;
  reps: number;
  /** Only while correcting a set; new sets are asked after saving. */
  feel?: Feel;
  warmup: boolean;
  side: ArnoldSet["side"];
};

/**
 * What the card shows. One card for the whole workout, so these are views of
 * the same card, not separate cards in the chat.
 */
type Phase =
  | { kind: "log" }
  | { kind: "rest"; until: number; seconds: number }
  | { kind: "exerciseDone" }
  | { kind: "menu" }
  | { kind: "pick" }
  | { kind: "swap"; all: boolean };

/** A place in today's session: a plan item, or an exercise added today. */
type Slot = { exerciseId: string; item?: ArnoldPlanItem };

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

/** "82,5 × 8" for a set chip; the full line is in its accessible name. */
function shortSet(set: ArnoldSet) {
  const reps =
    set.load_basis === "bodyweight_only" || set.load_kg === null
      ? `${set.reps} Wdh.`
      : `${formatNumber(set.load_kg, 2)} × ${set.reps}`;
  const side = set.side === "left" ? " L" : set.side === "right" ? " R" : "";
  return `${set.set_type === "warmup" ? "Aufw. " : ""}${reps}${side}`;
}

/** "+2,5 kg" against last time; a plain comparison of two shown values. */
function compareToLast(
  last: { load_kg: number | null; reps: number },
  form: Form,
  bodyweight: boolean,
): { text: string; up: boolean } {
  const reps = form.reps - last.reps;
  const repsText =
    reps > 0
      ? `+${reps} Wdh.`
      : reps < 0
        ? `−${-reps} Wdh.`
        : "wie letztes Mal";
  if (bodyweight || last.load_kg === null || !form.weightKnown)
    return { text: repsText, up: reps > 0 };
  const load = Math.round((form.weight - last.load_kg) * 1000) / 1000;
  if (load === 0) return { text: repsText, up: reps > 0 };
  return load > 0
    ? { text: `+${formatNumber(load, 2)} kg`, up: true }
    : { text: `−${formatNumber(-load, 2)} kg`, up: false };
}

function useCountdown(until: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

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

  // A swapped exercise takes over its plan item's place for this workout.
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const slots: Slot[] = items.map((item) => ({
    exerciseId: swaps[item.plan_item_id] ?? item.exercise_id,
    item,
  }));
  // Exercises trained today outside the plan keep their sets visible.
  for (const set of sets)
    if (!slots.some((slot) => slot.exerciseId === set.exercise_id))
      slots.push({ exerciseId: set.exercise_id });
  const slotOf = (id: string | undefined) =>
    slots.find((slot) => slot.exerciseId === id);
  const isOpen = (slot: Slot) =>
    !!slot.item && workingSets(slot.exerciseId) < (slot.item.target_sets ?? 1);
  /** The plan item a set belongs to: only one planned for this very exercise. */
  const ownItem = (id: string | undefined) => {
    const item = slotOf(id)?.item;
    return item && item.exercise_id === id ? item : undefined;
  };

  const catalog = data.exercises.filter((e) => e.status === "active");
  const firstOpen =
    slots.find(isOpen)?.exerciseId ??
    sets[sets.length - 1]?.exercise_id ??
    slots[0]?.exerciseId ??
    catalog[0]?.exercise_id;

  const [exerciseId, setExerciseId] = useState(firstOpen);
  const [phase, setPhase] = useState<Phase>({ kind: "log" });
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>(
    {},
  );
  const [edit, setEdit] = useState<ArnoldSet>();
  const [unusualSending, setUnusualSending] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const slot = slotOf(exerciseId);
  const item = ownItem(exerciseId);
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
    const own = ownItem(id);
    const planned = slotOf(id)?.item;
    const rule = conventions(own, id ? exercises.get(id) : undefined);
    return {
      weight: last?.load_kg ?? own?.target_load_kg ?? 0,
      weightKnown: last?.load_kg != null || own?.target_load_kg != null,
      reps: last?.reps ?? planned?.rep_max ?? planned?.rep_min ?? 8,
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
    setInvalidFields({});
    setExerciseId(id);
    setEdit(undefined);
    setPhase({ kind: "log" });
    touched.current = false;
    setFormState(prefill(id));
  };

  // The last time this exercise was trained, as it was stored: the starting
  // values for its first set today and the comparison under the steppers.
  const [previous, setPrevious] = useState<{
    line: string;
    date: string;
    load_kg: number | null;
    reps: number;
  }>();
  useEffect(() => {
    setPrevious(undefined);
    if (!exerciseId) return;
    const basis = rules.load_basis;
    let active = true;
    void client
      .workouts({
        exercise_ids: [exerciseId],
        workout_statuses: ["completed"],
        limit: 5,
      })
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
              !s.voided &&
              s.set_type !== "warmup" &&
              s.load_basis === basis &&
              s.execution_mode === rules.execution_mode &&
              s.implement_count === rules.implement_count &&
              s.side === form.side,
          )
          .at(-1);
        if (!active || !earlier || !last) return;
        setPrevious({
          line: formatSetLine(last),
          date: earlier.date,
          load_kg: last.load_kg,
          reps: last.reps,
        });
        if (!touched.current && !sets.some((s) => s.exercise_id === exerciseId))
          setFormState((f) => ({
            ...f,
            weight: last.load_kg ?? f.weight,
            weightKnown: last.load_kg !== null || f.weightKnown,
            reps: last.reps,
          }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [
    exerciseId,
    rules.load_basis,
    rules.execution_mode,
    rules.implement_count,
    form.side,
    workout.workout_id,
  ]);

  const done = sets
    .filter((s) => s.exercise_id === exerciseId)
    .sort((a, b) => a.set_number - b.set_number);
  const doneWorking = exerciseId ? workingSets(exerciseId) : 0;
  const target = slot?.item?.target_sets ?? null;
  const reps = slot?.item ? repRange(slot.item) : null;
  const restSeconds = slot?.item?.rest_seconds || DEFAULT_REST_SECONDS;
  const disabled = logger.busy || !!logger.pending;
  const bodyweight = rules.load_basis === "bodyweight_only";
  const planned = slots.filter((s) => s.item);
  const position = planned.findIndex((s) => s.exerciseId === exerciseId);
  const name = (id: string) => exercises.get(id)?.name_de ?? "Übung";
  const current = slots.findIndex((s) => s.exerciseId === exerciseId);
  const nextOpen = (
    slots.slice(current + 1).find(isOpen) ??
    slots.find((s) => isOpen(s) && s.exerciseId !== exerciseId)
  )?.exerciseId;
  const remaining = useCountdown(
    phase.kind === "rest" ? phase.until : undefined,
  );
  const latest = [...done].reverse().find((s) => s.set_type !== "warmup");

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

  const finish = () => {
    onFinish();
    void logger.write("complete_workout", {
      workout_id: workout.workout_id,
      expected_row_revision: workout.row_revision,
    });
  };

  async function save(confirmedUnusual = false) {
    if (
      !exerciseId ||
      Object.values(invalidFields).some(Boolean) ||
      (!bodyweight && !form.weightKnown)
    )
      return;
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
      rir: edit ? (form.feel === undefined ? null : Number(form.feel)) : null,
    };
    const response = edit
      ? await logger.write("update_set", {
          set_id: edit.set_id,
          expected_row_revision: edit.row_revision,
          changes: fields,
          ...(confirmedUnusual ? { confirm_unusual_values: true } : {}),
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
          ...(confirmedUnusual ? { confirm_unusual_values: true } : {}),
        });
    if (!response?.ok) return;
    const wasEdit = !!edit;
    const wasWarmup = form.warmup;
    const side = form.side;
    setEdit(undefined);
    // After the left side comes the right side; the numbers usually repeat.
    setForm((f) => ({
      ...f,
      feel: undefined,
      warmup: false,
      side: f.side === "left" ? "right" : f.side === "right" ? "left" : f.side,
    }));
    if (wasEdit || wasWarmup || side === "left") return;
    if (target !== null && doneWorking + 1 >= target)
      setPhase({ kind: "exerciseDone" });
    else
      setPhase({
        kind: "rest",
        until: Date.now() + restSeconds * 1000,
        seconds: restSeconds,
      });
  }

  function correct(set: ArnoldSet) {
    setInvalidFields({});
    setEdit(set);
    setPhase({ kind: "log" });
    setFormState({
      weight: set.load_kg ?? 0,
      weightKnown: set.load_kg !== null,
      reps: set.reps,
      warmup: set.set_type === "warmup",
      side: set.side,
      feel: feelOf(set.rir),
    });
  }

  /** How the set just saved felt, stored on that set. */
  function rate(feel: Feel | undefined) {
    if (!latest) return;
    void logger.write("update_set", {
      set_id: latest.set_id,
      expected_row_revision: latest.row_revision,
      changes: { rir: feel === undefined ? null : Number(feel) },
    });
  }

  const recovery = logger.error && (
    <RecoveryNotice
      message={logger.failure?.message}
      code={logger.failure?.code}
      recovery={logger.failure?.recovery ?? "retry_same_request"}
      onAction={
        logger.pending
          ? undefined
          : logger.failure?.recovery === "reload_then_retry"
            ? () => void logger.reload()
            : undefined
      }
      busy={logger.busy}
    />
  );

  const heading =
    position >= 0
      ? `${workout.session_name_snapshot} · Übung ${position + 1} von ${planned.length}`
      : workout.session_name_snapshot;
  const progress = planned.length > 0 && (
    <div
      className="ac-progress"
      role="img"
      aria-label={`${planned.filter((s) => !isOpen(s)).length} von ${planned.length} Übungen erledigt`}
    >
      {planned.map((s, i) => {
        const goal = s.item?.target_sets ?? 1;
        const share = Math.min(1, workingSets(s.exerciseId) / goal);
        return (
          <i key={s.item?.plan_item_id ?? i}>
            <b style={{ width: `${share * 100}%` }} />
          </i>
        );
      })}
    </div>
  );
  const label = (
    <span className="ac-label-col">
      <span>{heading}</span>
      {progress}
    </span>
  );
  const menuButton = (
    <button
      type="button"
      className="ac-icon-btn"
      aria-label="Weitere Aktionen"
      aria-expanded={phase.kind === "menu"}
      disabled={disabled}
      onClick={() =>
        setPhase(phase.kind === "menu" ? { kind: "log" } : { kind: "menu" })
      }
    >
      <MoreHorizontal size={18} aria-hidden="true" />
    </button>
  );
  const setChips = (
    <div className="ac-sets" role="group" aria-label="Sätze dieser Übung">
      {done.map((set) => (
        <button
          key={set.set_id}
          type="button"
          className={`ac-set done${set.set_type === "warmup" ? " warmup" : ""}`}
          aria-pressed={edit?.set_id === set.set_id}
          aria-label={`Satz ${set.set_number} korrigieren: ${formatSetLine(set)}${set.set_type === "warmup" ? " · Aufwärmen" : ""}`}
          disabled={disabled}
          onClick={() =>
            edit?.set_id === set.set_id ? choose(exerciseId) : correct(set)
          }
        >
          {shortSet(set)}
        </button>
      ))}
      {!edit &&
        Array.from(
          { length: target === null ? 1 : Math.max(0, target - doneWorking) },
          (_, i) => (
            <span
              key={`open-${i}`}
              className={`ac-set ${i === 0 ? "now" : ""}`}
              aria-hidden="true"
            >
              Satz {doneWorking + i + 1}
            </span>
          ),
        )}
    </div>
  );

  if (logger.failure?.code === "CONFIRMATION_REQUIRED" || unusualSending)
    return (
      <ArnoldCard
        label={exercise?.name_de}
        title="Stimmt das?"
        subtitle="Dieser Satz liegt über den üblichen Eingabewerten. Prüfe Gewicht und Wiederholungen."
      >
        <p className="ac-section-title">
          {bodyweight ? "Körpergewicht" : `${formatNumber(form.weight, 2)} kg`}{" "}
          × {form.reps}
        </p>
        <CardActions
          primary={{
            label: unusualSending
              ? "Wird gespeichert …"
              : "Ja, diese Werte speichern",
            disabled: logger.busy || unusualSending,
            onClick: () => {
              setUnusualSending(true);
              void save(true).finally(() => setUnusualSending(false));
            },
          }}
          secondary={{
            label: "Werte korrigieren",
            disabled: logger.busy || unusualSending,
            onClick: () => logger.clearError(),
          }}
        />
      </ArnoldCard>
    );

  if (confirmVoid && edit)
    return (
      <ArnoldCard
        label={exercise?.name_de}
        title="Diesen Satz verwerfen?"
        subtitle={`${formatSetLine(edit)} · Der Satz bleibt im Verlauf als verworfen sichtbar.`}
      >
        {recovery}
        <CardActions
          primary={{
            label: logger.pending ? "Erneut prüfen" : "Ja, Satz verwerfen",
            tone: "danger",
            disabled: logger.busy,
            onClick: () => {
              void (
                logger.pending
                  ? logger.retry()
                  : logger.write("void_set", {
                      set_id: edit.set_id,
                      expected_row_revision: edit.row_revision,
                    })
              ).then((result) => {
                if (result?.ok) {
                  setConfirmVoid(false);
                  choose(exerciseId);
                }
              });
            },
          }}
          secondary={{
            label: "Satz behalten",
            disabled: disabled,
            onClick: () => setConfirmVoid(false),
          }}
        />
      </ArnoldCard>
    );

  if (confirmCancel)
    return (
      <ArnoldCard
        label={workout.session_name_snapshot}
        title="Training abbrechen?"
        subtitle="Das Training wird als abgebrochen gespeichert und zählt nicht in deine Auswertung."
      >
        {recovery}
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

  // An unconfirmed save is settled before anything else happens.
  const view = logger.pending ? "log" : phase.kind;

  if (view === "menu") {
    const entry = (
      text: string,
      onClick: () => void,
      options: { disabled?: boolean; danger?: boolean } = {},
    ) => (
      <li>
        <button
          type="button"
          className={`ac-menu-item${options.danger ? " danger" : ""}`}
          disabled={disabled || options.disabled}
          onClick={onClick}
        >
          {text}
        </button>
      </li>
    );
    return (
      <ArnoldCard label={label} aside={menuButton} title="Was möchtest du tun?">
        <ul className="ac-menu">
          {entry("Aufwärmsatz eintragen", () => {
            setEdit(undefined);
            setForm((f) => ({ ...f, warmup: true }));
            setPhase({ kind: "log" });
          })}
          {entry("Übung wechseln", () => setPhase({ kind: "pick" }), {
            disabled: slots.length < 2 && catalog.length < 2,
          })}
          {entry(
            "Übung tauschen",
            () => setPhase({ kind: "swap", all: false }),
            { disabled: catalog.length < 2 },
          )}
          {entry("Übung überspringen", () => choose(nextOpen), {
            disabled: !nextOpen,
          })}
          {entry("Training beenden", finish, { disabled: !sets.length })}
          {entry("Training abbrechen", () => setConfirmCancel(true), {
            danger: true,
          })}
        </ul>
        {recovery}
        <CardActions
          secondary={{
            label: "Zurück",
            onClick: () => setPhase({ kind: "log" }),
          }}
        />
      </ArnoldCard>
    );
  }

  if (view === "pick") {
    const choices: Slot[] = planned.length
      ? slots
      : catalog.map((e) => ({ exerciseId: e.exercise_id }));
    return (
      <ArnoldCard label={label} aside={menuButton} title="Übung wählen">
        <ul className="ac-menu">
          {choices.map((s) => {
            const goal = s.item?.target_sets;
            const count = workingSets(s.exerciseId);
            const status = goal
              ? count >= goal
                ? "erledigt"
                : `${count} von ${goal}`
              : count
                ? `${count} ${count === 1 ? "Satz" : "Sätze"}`
                : "";
            return (
              <li key={s.item?.plan_item_id ?? s.exerciseId}>
                <button
                  type="button"
                  className="ac-menu-item"
                  aria-current={s.exerciseId === exerciseId || undefined}
                  disabled={disabled}
                  onClick={() => choose(s.exerciseId)}
                >
                  <span>{name(s.exerciseId)}</span>
                  {status && <small>{status}</small>}
                </button>
              </li>
            );
          })}
        </ul>
        <CardActions
          secondary={{
            label: "Zurück",
            onClick: () => setPhase({ kind: "log" }),
          }}
        />
      </ArnoldCard>
    );
  }

  if (view === "swap" && phase.kind === "swap") {
    const muscle = exercise?.primary_muscle;
    const taken = new Set(slots.map((s) => s.exerciseId));
    const others = catalog.filter((e) => !taken.has(e.exercise_id));
    const similar = others.filter((e) => e.primary_muscle === muscle);
    const shown = phase.all || !similar.length ? others : similar;
    return (
      <ArnoldCard
        label={label}
        aside={menuButton}
        title={`${exercise?.name_de ?? "Übung"} tauschen`}
        subtitle="Die neue Übung übernimmt heute den Platz im Plan. Der Plan selbst bleibt gleich."
      >
        <ChipGroup
          label="Ersatzübung"
          options={shown.map((e) => ({
            value: e.exercise_id,
            label: e.name_de,
          }))}
          value={undefined}
          disabled={disabled}
          onChange={(id) => {
            if (!id) return;
            const planItem = slot?.item;
            if (planItem)
              setSwaps((s) => ({ ...s, [planItem.plan_item_id]: id }));
            choose(id);
          }}
        />
        <CardActions
          primary={
            !phase.all && similar.length && similar.length < others.length
              ? {
                  label: "Alle Übungen zeigen",
                  tone: "secondary",
                  onClick: () => setPhase({ kind: "swap", all: true }),
                }
              : undefined
          }
          secondary={{
            label: "Zurück",
            onClick: () => setPhase({ kind: "log" }),
          }}
        />
      </ArnoldCard>
    );
  }

  if (view === "rest" && phase.kind === "rest" && latest) {
    const over = remaining === 0;
    return (
      <ArnoldCard label={label} aside={menuButton}>
        <p className="ac-saved" role="status">
          <span className="ac-mark" aria-hidden="true">
            <Check size={14} strokeWidth={3} />
          </span>
          Satz {doneWorking} gespeichert · {formatSetLine(latest)}
        </p>
        <div className="ac-rest">
          <span className="ac-stepper-label">
            {over ? "Pause vorbei" : "Pause"}
          </span>
          <span className="ac-rest-clock" role="timer" aria-live="off">
            {clock(remaining)}
          </span>
          <div className="ac-rest-bar" aria-hidden="true">
            <b style={{ width: `${(remaining / phase.seconds) * 100}%` }} />
          </div>
        </div>
        <div className="ac-field ac-feel">
          <p className="ac-text">
            Wie viele wären noch gegangen?{" "}
            <span className="ac-optional">Freiwillig</span>
          </p>
          <ChipGroup
            label="Wie viele wären noch gegangen?"
            options={FEEL}
            value={feelOf(latest.rir)}
            onChange={rate}
            disabled={disabled}
            allowNone
          />
        </div>
        {recovery}
        <p className="ac-hint">
          Als Nächstes: Satz {doneWorking + 1}
          {target ? ` von ${target}` : ""} ·{" "}
          {bodyweight
            ? `${form.reps} Wdh.`
            : `${formatNumber(form.weight, 2)} kg × ${form.reps}`}
        </p>
        <CardActions
          primary={{
            label: over ? "Nächster Satz" : "Pause überspringen",
            tone: over ? "primary" : "secondary",
            onClick: () => setPhase({ kind: "log" }),
          }}
        />
      </ArnoldCard>
    );
  }

  if (view === "exerciseDone") {
    return (
      <ArnoldCard label={label} aside={menuButton}>
        <div className="ac-done">
          <span className="ac-mark large" aria-hidden="true">
            <Check size={28} strokeWidth={3} />
          </span>
          <h2 className="ac-title">{exercise?.name_de ?? "Übung"} geschafft</h2>
          <p className="ac-sub">
            {doneWorking} {doneWorking === 1 ? "Satz" : "Sätze"} gespeichert
          </p>
        </div>
        {setChips}
        {recovery}
        <CardActions
          primary={
            nextOpen
              ? {
                  label: `Weiter: ${name(nextOpen)}`,
                  disabled,
                  onClick: () => choose(nextOpen),
                }
              : {
                  label: "Training beenden",
                  disabled: disabled || !sets.length,
                  onClick: finish,
                }
          }
          secondary={{
            label: "Noch ein Satz",
            disabled,
            onClick: () => setPhase({ kind: "log" }),
          }}
        />
      </ArnoldCard>
    );
  }

  const comparison =
    previous && !edit ? compareToLast(previous, form, bodyweight) : undefined;
  return (
    <ArnoldCard
      label={label}
      aside={menuButton}
      title={exercise?.name_de ?? "Übung wählen"}
      subtitle={
        edit
          ? `Satz ${edit.set_number} korrigieren`
          : target && doneWorking >= target
            ? "Alle geplanten Sätze geschafft"
            : `Satz ${doneWorking + 1}${target ? ` von ${target}` : ""}${reps ? ` · Ziel ${reps} Wdh.` : ""}`
      }
    >
      {setChips}
      {form.warmup && !edit && (
        <button
          type="button"
          className="ac-chip"
          aria-pressed="true"
          disabled={disabled}
          onClick={() => setForm((f) => ({ ...f, warmup: false }))}
        >
          Aufwärmsatz · zum Ausschalten tippen
        </button>
      )}
      {!bodyweight && !form.weightKnown && (
        <p className="ac-caption">
          Stelle zuerst dein Gewicht ein. Es ist noch kein Gewicht hinterlegt.
        </p>
      )}
      <div className={`ac-steppers${bodyweight ? "" : " pair"}`}>
        {!bodyweight && (
          <Stepper
            key={`${exerciseId}-weight`}
            onValidityChange={(valid) =>
              setInvalidFields((f) => ({ ...f, weight: !valid }))
            }
            label={LOAD_LABEL[rules.load_basis]}
            value={form.weight}
            unit="kg"
            step={rules.load_basis === "per_implement" ? 1 : 2.5}
            onChange={(weight) =>
              setForm((f) => ({ ...f, weight, weightKnown: true }))
            }
            disabled={disabled}
            format={(v) => formatNumber(v, 2)}
          />
        )}
        <Stepper
          key={`${exerciseId}-reps`}
          onValidityChange={(valid) =>
            setInvalidFields((f) => ({ ...f, reps: !valid }))
          }
          label="Wiederholungen"
          value={form.reps}
          step={1}
          min={1}
          onChange={(reps) => setForm((f) => ({ ...f, reps }))}
          disabled={disabled}
        />
      </div>
      {previous && !edit && (
        <p className="ac-compare">
          <span>
            Letztes Mal: {previous.line} · {dateLabel(previous.date)}
          </span>
          {comparison && (
            <strong className={comparison.up ? "up" : undefined}>
              {comparison.text}
            </strong>
          )}
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
      {edit && (
        <div className="ac-field ac-feel">
          <p className="ac-text">
            Wie viele wären noch gegangen?{" "}
            <span className="ac-optional">Freiwillig</span>
          </p>
          <ChipGroup
            label="Wie viele wären noch gegangen?"
            options={FEEL}
            value={form.feel}
            onChange={(feel) => setForm((f) => ({ ...f, feel }))}
            disabled={disabled}
            allowNone
          />
        </div>
      )}
      {recovery}
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
            disabled:
              disabled ||
              Object.values(invalidFields).some(Boolean) ||
              (!bodyweight && !form.weightKnown),
          }}
          secondary={{
            label: "Satz verwerfen",
            disabled,
            onClick: () => setConfirmVoid(true),
          }}
        />
      ) : (
        <CardActions
          primary={{
            label: logger.busy
              ? "Wird gespeichert …"
              : form.warmup
                ? "Aufwärmsatz speichern"
                : `Satz ${doneWorking + 1} speichern`,
            onClick: () => void save(),
            disabled:
              disabled ||
              !exerciseId ||
              Object.values(invalidFields).some(Boolean) ||
              (!bodyweight && !form.weightKnown),
          }}
        />
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
            {
              label: summary.exercise_count === 1 ? "Übung" : "Übungen",
              value: summary.exercise_count,
            },
            {
              label:
                summary.working_set_count === 1
                  ? "Arbeitssatz"
                  : "Arbeitssätze",
              value: summary.working_set_count,
            },
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
