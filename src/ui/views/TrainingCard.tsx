import { useEffect, useMemo, useRef, useState } from "react";
import { Check, MessageCircle, Trophy } from "lucide-react";
import type {
  ArnoldExercise,
  ArnoldSet,
  ArnoldWorkout,
} from "../../shared/arnold-schema-v1";
import type { ArnoldDashboardView } from "../../shared/arnold-view";
import type {
  SessionProposal,
  WorkoutContext,
  WriteResponse,
} from "../../shared/workout-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { useWorkoutLogger } from "../hooks/useWorkoutLogger";
import { useModelContext } from "../hooks/useModelContext";
import {
  finishMessage,
  runningContext,
  savedContext,
  todayContext,
} from "../model-context";
import {
  ArnoldCard,
  CardActions,
  CardNote,
  CardSkeleton,
  ChipGroup,
  Rows,
} from "../components/cards";
import { WorkoutEditor } from "../components/workout-editor";
import { dateLabel, formatNumber } from "../format";
import { RecoveryCard, RecoveryNotice } from "../components/recovery";
import type { CardId } from "../cards";
import { PlanDay } from "../components/plan-day";
import { usePlanReplace } from "../hooks/usePlanReplace";
import {
  carryOver,
  draftFromProposal,
  draftFromSaved,
  exerciseLine,
  missing,
  plannedExercise,
  requestExercises,
  unchanged,
  type Draft,
} from "../workout-draft";

type Logger = ReturnType<typeof useWorkoutLogger>;

const WEEKDAY = new Intl.DateTimeFormat("de-DE", { weekday: "long" });
const localDate = () => new Intl.DateTimeFormat("en-CA").format(new Date());
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * "Training starten": the day's plan with the weights from last time, saved
 * with one tap. Anything different is changed under "Anpassen" or simply told
 * to the chat. There is no set-by-set walk through the workout.
 *
 * One card that changes its content: today's plan, the editor, the saved
 * workout. A workout started set by set from the chat is shown as running.
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
  // Set when the user saves here, so only that save is posted to the chat,
  // never one replayed when the chat is reopened.
  const announced = useRef<string | undefined>(undefined);
  const [another, setAnother] = useState(false);

  // Opening the card shows what is going on today: a running workout first,
  // else one already saved today, else today's plan.
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (!data || resumed) return;
    if (workout) {
      setResumed(true);
      return;
    }
    const running = [...data.workouts].sort((a, b) =>
      b.created_at_utc.localeCompare(a.created_at_utc),
    )[0];
    const today = view.recent_workouts.find(
      (w) => w.status === "completed" && w.date === localDate(),
    );
    const id = running?.workout_id ?? today?.workout_id;
    if (id) void logger.select(id).finally(() => setResumed(true));
    else setResumed(true);
  }, [data, workout, resumed]);

  if (!data)
    return logger.error ? (
      <RecoveryCard
        recovery={logger.failure?.recovery ?? "retry_same_request"}
        onAction={() => void logger.reload()}
      />
    ) : (
      <CardSkeleton />
    );
  if (!resumed) return <CardSkeleton />;
  if (workout?.status === "in_progress")
    return (
      <RunningCard
        client={client}
        logger={logger}
        data={data}
        workout={workout}
      />
    );
  if (workout?.status === "completed" && !another)
    return (
      <SavedCard
        key={workout.workout_id}
        client={client}
        logger={logger}
        data={data}
        workout={workout}
        view={view}
        onOpen={onOpen}
        onAnother={() => setAnother(true)}
        announce={announced.current === workout.workout_id}
        onAnnounced={() => {
          announced.current = undefined;
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
      onChanged={onChanged}
      undone={workout?.status === "voided"}
      onSaved={(id) => {
        announced.current = id;
        setAnother(false);
      }}
    />
  );
}

/* ------------------------------------------------------------------ today */

const unusual = (logger: Logger) =>
  logger.failure?.code === "CONFIRMATION_REQUIRED";
const duplicate = (logger: Logger) =>
  logger.failure?.code === "DUPLICATE_WORKOUT";

/**
 * Saving a workout, with a question first for what is almost certainly a
 * slip: an unusual value ("Stimmt das?") or the same training twice on one
 * day. The confirmed resend is a new request with the same values.
 */
function useLogWorkout(
  logger: Logger,
  onDone: (response: WriteResponse) => void,
) {
  const last = useRef<Record<string, unknown> | undefined>(undefined);
  const send = async (input: Record<string, unknown>) => {
    last.current = input;
    const response = await logger.write("log_workout", input);
    if (response?.ok) onDone(response);
    return response;
  };
  const resend = (flag: string) => () =>
    void send({ ...last.current!, [flag]: true });
  const confirm = !last.current
    ? undefined
    : unusual(logger)
      ? {
          label: "Ja, diese Werte speichern",
          onClick: resend("confirm_unusual_values"),
          disabled: logger.busy,
        }
      : duplicate(logger)
        ? {
            label: "Trotzdem speichern",
            onClick: resend("confirm_duplicate"),
            disabled: logger.busy,
          }
        : undefined;
  return { send, confirm };
}

function Notes({ logger, data }: { logger: Logger; data: WorkoutContext }) {
  return (
    <>
      {unusual(logger) && (
        <div className="ac-confirm" role="alert">
          <h3 className="ac-section-title">Stimmt das?</h3>
          <p className="ac-text">
            Ein Wert ist ungewöhnlich hoch (über 500 kg oder über 100
            Wiederholungen). Es wurde noch nichts gespeichert.
          </p>
        </div>
      )}
      {duplicate(logger) && (
        <div className="ac-confirm" role="alert">
          <h3 className="ac-section-title">Schon eingetragen</h3>
          <p className="ac-text">
            Dieses Training ist für heute schon gespeichert. Noch einmal
            speichern ergibt zwei Trainings. Es wurde nichts gespeichert.
          </p>
        </div>
      )}
      {logger.error && !unusual(logger) && !duplicate(logger) && (
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
          Die Speicherung ist noch nicht bestätigt. Prüfe sie, bevor du etwas
          Neues einträgst.
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
}

/** The session that comes next: after the last completed one of this plan. */
function useNextSession(
  view: ArnoldDashboardView,
  proposals: SessionProposal[],
) {
  return useMemo(() => {
    const next = view.home?.next_session?.session_id;
    const index = proposals.findIndex((p) => p.session_id === next);
    if (index >= 0) return index;
    const last = view.recent_workouts.find(
      (w) => w.status === "completed" && w.session_id,
    );
    const lastIndex = proposals.findIndex(
      (p) => p.session_id === last?.session_id,
    );
    return lastIndex < 0 ? 0 : (lastIndex + 1) % proposals.length;
  }, [view, proposals]);
}

function TodayCard({
  client,
  logger,
  data,
  view,
  onOpen,
  onChanged,
  undone,
  onSaved,
}: {
  client: ArnoldMcpClient;
  logger: Logger;
  data: WorkoutContext;
  view: ArnoldDashboardView;
  onOpen: (card: CardId) => void;
  onChanged: () => void;
  undone: boolean;
  onSaved: (workoutId: string) => void;
}) {
  const proposals = data.proposals;
  const nextIndex = useNextSession(view, proposals);
  const [chosen, setChosen] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  const proposal =
    proposals.find((p) => p.session_id === chosen) ?? proposals[nextIndex];
  const disabled = logger.busy || !!logger.pending || !data.can_write;
  const plan = view.active_plan;
  const planReplace = usePlanReplace(client);
  const [replacedInPlan, setReplacedInPlan] = useState<Record<string, string>>(
    {},
  );

  // The draft is what "So gemacht" saves. It follows the chosen day; when the
  // plan itself changes ("Dauerhaft im Plan"), the user's other changes stay.
  const [held, setHeld] = useState<{ base: SessionProposal; draft: Draft }>();
  let current = held;
  if (
    proposal &&
    (!held ||
      held.base.session_id !== proposal.session_id ||
      held.base.plan_version_id !== proposal.plan_version_id)
  ) {
    current = {
      base: proposal,
      draft:
        held && held.base.session_id === proposal.session_id
          ? carryOver(held.draft, held.base, proposal)
          : draftFromProposal(proposal),
    };
    setHeld(current);
  }
  const draft = current?.draft;
  const changed = !!proposal && !!draft && !unchanged(draft, proposal);

  useModelContext(
    client,
    todayContext({
      proposal,
      planName: plan?.name,
      of: proposals.length,
      editing: changed,
      canWrite: data.can_write,
    }),
  );

  const { send, confirm } = useLogWorkout(logger, (response) => {
    if (!response.result?.workout) return;
    onSaved(response.result.workout.workout_id);
  });
  const save = async () => {
    if (!proposal || !draft) return;
    await send({
      workout_date_local: localDate(),
      timezone: timezone(),
      plan_version_id: proposal.plan_version_id,
      session_id: proposal.session_id,
      ...(changed ? { exercises: requestExercises(draft) } : {}),
      source: "ui",
    });
  };

  const label = `Heute · ${WEEKDAY.format(new Date())}`;
  if (!proposal || !draft)
    return (
      <ArnoldCard
        label={label}
        title="Freies Training"
        subtitle="Du hast keinen aktiven Plan."
      >
        <p className="ac-text">
          Schreib Arnold im Chat, was du gemacht hast, zum Beispiel „Bankdrücken
          60 kg, 3 × 10 und Klimmzüge 3 × 8“. Arnold trägt es direkt ein.
        </p>
        <Notes logger={logger} data={data} />
        <CardActions
          primary={{ label: "Plan erstellen", onClick: () => onOpen("plan") }}
          secondary={{ label: "Übersicht", onClick: () => onOpen("home") }}
        />
      </ArnoldCard>
    );

  const incomplete =
    !draft.exercises.length ||
    draft.exercises.some((e) => missing(e).length > 0);
  const fromLast = proposal.exercises.filter((e) => e.source === "last_time");
  const count = proposal.exercises.length;
  const subtitle = `${count} ${count === 1 ? "Übung" : "Übungen"} · ${
    fromLast.length === count
      ? "Werte vom letzten Mal"
      : fromLast.length
        ? "vom letzten Mal, sonst aus dem Plan"
        : "Werte aus deinem Plan"
  }`;

  const replaceInPlan = async (planItemId: string, next: ArnoldExercise) => {
    const before = proposal.exercises.find(
      (e) => e.plan_item_id === planItemId,
    )?.exercise_name;
    const error = await planReplace.replace({
      planVersionId: proposal.plan_version_id,
      planItemId,
      exerciseId: next.exercise_id,
    });
    if (error) return error;
    // The new plan version may move "next session"; stay on this day.
    setChosen(proposal.session_id);
    if (before)
      setReplacedInPlan((all) => ({ ...all, [next.exercise_id]: before }));
    await logger.reload();
    onChanged();
    return undefined;
  };

  return (
    <ArnoldCard
      className="ac-training"
      label={label}
      aside={
        proposals.length > 1 ? (
          <span className="ac-label">
            Tag {proposal.session_order} von {proposals.length}
          </span>
        ) : undefined
      }
      title={proposal.session_name}
      subtitle={subtitle}
      busy={logger.busy || planReplace.busy}
    >
      {undone && <CardNote>Das Training wurde zurückgenommen.</CardNote>}
      {choosing && (
        <ChipGroup
          label="Trainingstag"
          options={proposals.map((p) => ({
            value: p.session_id,
            label: p.session_name,
          }))}
          value={proposal.session_id}
          onChange={(value) => {
            if (value) setChosen(value);
            setChoosing(false);
          }}
        />
      )}
      <PlanDay
        key={proposal.session_id}
        proposal={proposal}
        draft={draft}
        catalog={data.exercises}
        onChange={(next) => setHeld({ base: proposal, draft: next })}
        onReplaceInPlan={replaceInPlan}
        replacing={planReplace.busy}
        replacedInPlan={replacedInPlan}
        disabled={disabled || planReplace.busy}
        readOnly={!data.can_write}
      />
      <Notes logger={logger} data={data} />
      <CardActions
        primary={
          !data.can_write
            ? { label: "Zur Übersicht", onClick: () => onOpen("home") }
            : confirm
              ? confirm
              : logger.pending
                ? {
                    label: "Erneut prüfen",
                    onClick: () => void logger.retry(),
                    disabled: logger.busy,
                  }
                : {
                    label: (
                      <>
                        <Check size={16} aria-hidden="true" />
                        {logger.busy ? "Speichert …" : "So gemacht"}
                      </>
                    ),
                    ariaLabel: "So gemacht, speichern",
                    onClick: () => void save(),
                    disabled: disabled || incomplete || planReplace.busy,
                  }
        }
        secondary={
          confirm
            ? { label: "Werte ändern", onClick: () => logger.clearError() }
            : undefined
        }
      />
      {!confirm && data.can_write && (
        <div className="ac-quiet-row">
          {proposals.length > 1 && (
            <button
              type="button"
              className="ac-link ac-quiet"
              onClick={() => setChoosing((c) => !c)}
            >
              Anderer Tag
            </button>
          )}
          <button
            type="button"
            className="ac-link ac-quiet"
            onClick={() => onOpen("home")}
          >
            Zur Übersicht
          </button>
        </div>
      )}
    </ArnoldCard>
  );
}

/* ------------------------------------------------------------------ saved */

/** Saved sets grouped per exercise, in workout order. */
function groupSets(sets: readonly ArnoldSet[]) {
  const groups = new Map<number, ArnoldSet[]>();
  for (const set of sets)
    if (set.status === "active" && set.set_type === "working")
      groups.set(set.exercise_order, [
        ...(groups.get(set.exercise_order) ?? []),
        set,
      ]);
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => list.sort((a, b) => a.set_number - b.set_number));
}

function savedLine(list: readonly ArnoldSet[]) {
  const first = list[0];
  return exerciseLine({
    conventions: {
      load_basis: first.load_basis,
      execution_mode: first.execution_mode,
      implement_count: first.implement_count,
      reps_basis: first.reps_basis,
    },
    sets: list.map((s) => ({ reps: s.reps, load_kg: s.load_kg, side: s.side })),
  });
}

function SavedCard({
  client,
  logger,
  data,
  workout,
  view,
  onOpen,
  onAnother,
  announce,
  onAnnounced,
}: {
  client: ArnoldMcpClient;
  logger: Logger;
  data: WorkoutContext;
  workout: ArnoldWorkout;
  view: ArnoldDashboardView;
  onOpen: (card: CardId) => void;
  onAnother: () => void;
  announce: boolean;
  onAnnounced: () => void;
}) {
  const [draft, setDraft] = useState<Draft>();
  const [confirmUndo, setConfirmUndo] = useState(false);
  const groups = groupSets(data.sets);
  const proposal = data.proposals.find(
    (p) => p.session_id === workout.session_id,
  );
  const summary = view.recent_workouts.find(
    (w) => w.workout_id === workout.workout_id && w.status === "completed",
  );
  const records = view.records.filter(
    (r) => r.workout_id === workout.workout_id && r.kind === "improvement",
  );
  const record =
    records.find((r) => r.metric === "max_load") ?? records[0] ?? undefined;
  const disabled = logger.busy || !!logger.pending || !data.can_write;
  const canEdit = data.can_write && data.can_correct_completed;

  useModelContext(
    client,
    savedContext({ workout, sets: data.sets, editing: !!draft }),
  );

  // Saving here hands the turn to the chat once, with the engine's numbers.
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

  const { send, confirm } = useLogWorkout(logger, () => setDraft(undefined));
  const notes = <Notes logger={logger} data={data} />;
  if (draft)
    return (
      <ArnoldCard
        className="ac-training ac-editing"
        label={`Bearbeiten · ${workout.session_name_snapshot}`}
        title="Was war anders?"
        subtitle={dateLabel(workout.workout_date_local, true)}
        busy={logger.busy}
      >
        <WorkoutEditor
          draft={draft}
          catalog={data.exercises}
          onChange={setDraft}
          restore={(id) => plannedExercise(proposal, id)}
          disabled={disabled}
        />
        {notes}
        <CardActions
          primary={
            confirm ?? {
              label: logger.busy
                ? "Wird gespeichert …"
                : "Änderungen speichern",
              onClick: () =>
                void send({
                  workout_date_local: workout.workout_date_local,
                  timezone: workout.timezone,
                  ...(workout.plan_version_id && workout.session_id
                    ? {
                        plan_version_id: workout.plan_version_id,
                        session_id: workout.session_id,
                      }
                    : {}),
                  session_name: workout.session_name_snapshot ?? "Training",
                  exercises: requestExercises(draft),
                  replaces_workout_id: workout.workout_id,
                  expected_row_revision: workout.row_revision,
                  source: "ui",
                }),
              disabled:
                disabled ||
                !draft.exercises.length ||
                draft.exercises.some((e) => missing(e).length > 0),
            }
          }
          secondary={{
            label: "Abbrechen",
            onClick: () => {
              setDraft(undefined);
              logger.clearError();
            },
            disabled: logger.busy,
          }}
        />
      </ArnoldCard>
    );

  return (
    <ArnoldCard
      className="ac-training ac-training-saved"
      label={
        <>
          <Check size={13} aria-hidden="true" />
          Gespeichert
        </>
      }
      aside={
        <span className="ac-label">
          {workout.workout_date_local === localDate()
            ? "Heute"
            : dateLabel(workout.workout_date_local)}
        </span>
      }
      title={workout.session_name_snapshot ?? "Training"}
      subtitle={
        summary
          ? `${summary.exercise_count} ${summary.exercise_count === 1 ? "Übung" : "Übungen"} · ${summary.working_set_count} ${summary.working_set_count === 1 ? "Satz" : "Sätze"}`
          : undefined
      }
      busy={logger.busy}
    >
      {logger.message && (
        <p className="visually-hidden" role="status">
          Training gespeichert.
        </p>
      )}
      <Rows
        label="Gespeicherte Übungen"
        items={groups.map((list) => ({
          key: `${list[0].exercise_order}`,
          label: list[0].exercise_name_snapshot,
          value: savedLine(list),
        }))}
      />
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
            <span className="ac-text">Neuer Rekord</span>
          </span>
        </div>
      )}
      <p className="ac-chat-hint">
        <MessageCircle size={15} aria-hidden="true" />
        <span>
          Stimmt etwas nicht? Tippe auf Bearbeiten oder sag es im Chat.
        </span>
      </p>
      {notes}
      <CardActions
        primary={
          logger.pending
            ? {
                label: "Erneut prüfen",
                onClick: () => void logger.retry(),
                disabled: logger.busy,
              }
            : { label: "Zur Übersicht", onClick: () => onOpen("home") }
        }
        secondary={
          canEdit
            ? {
                label: "Bearbeiten",
                onClick: () => setDraft(draftFromSaved(data.sets, proposal)),
                disabled,
              }
            : undefined
        }
      />
      <div className="ac-quiet-row">
        {canEdit &&
          (confirmUndo ? (
            <button
              type="button"
              className="ac-link danger"
              disabled={disabled}
              onClick={() =>
                void logger
                  .write("void_workout", {
                    workout_id: workout.workout_id,
                    expected_row_revision: workout.row_revision,
                    correction_reason: "In der Karte zurückgenommen",
                  })
                  .then(() => setConfirmUndo(false))
              }
            >
              Wirklich zurücknehmen?
            </button>
          ) : (
            <button
              type="button"
              className="ac-link ac-quiet"
              disabled={disabled}
              onClick={() => setConfirmUndo(true)}
            >
              Rückgängig
            </button>
          ))}
        <button type="button" className="ac-link ac-quiet" onClick={onAnother}>
          Noch ein Training eintragen
        </button>
      </div>
    </ArnoldCard>
  );
}

/* ---------------------------------------------------------------- running */

/**
 * A workout started set by set from the chat. The card lists what is saved
 * and lets the user finish it; logging itself happens in the chat.
 */
function RunningCard({
  client,
  logger,
  data,
  workout,
}: {
  client: ArnoldMcpClient;
  logger: Logger;
  data: WorkoutContext;
  workout: ArnoldWorkout;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const groups = groupSets(data.sets);
  const disabled = logger.busy || !!logger.pending || !data.can_write;
  useModelContext(client, runningContext({ workout, sets: data.sets }));
  return (
    <ArnoldCard
      className="ac-training"
      label={`Läuft · ${dateLabel(workout.workout_date_local)}`}
      title={workout.session_name_snapshot ?? "Training"}
      subtitle={
        groups.length
          ? `${groups.length} ${groups.length === 1 ? "Übung" : "Übungen"} eingetragen`
          : "Noch kein Satz eingetragen"
      }
      busy={logger.busy}
    >
      {groups.length > 0 && (
        <Rows
          label="Eingetragene Sätze"
          items={groups.map((list) => ({
            key: `${list[0].exercise_order}`,
            label: list[0].exercise_name_snapshot,
            value: savedLine(list),
          }))}
        />
      )}
      <p className="ac-chat-hint">
        <MessageCircle size={15} aria-hidden="true" />
        <span>Weitere Sätze sagst du einfach im Chat.</span>
      </p>
      <Notes logger={logger} data={data} />
      <CardActions
        primary={{
          label: logger.busy ? "Wird gespeichert …" : "Training abschließen",
          onClick: () =>
            void logger.write("complete_workout", {
              workout_id: workout.workout_id,
              expected_row_revision: workout.row_revision,
            }),
          disabled: disabled || !groups.length,
        }}
        secondary={
          confirmCancel
            ? {
                label: "Wirklich verwerfen?",
                tone: "danger",
                onClick: () =>
                  void logger
                    .write("cancel_workout", {
                      workout_id: workout.workout_id,
                      expected_row_revision: workout.row_revision,
                    })
                    .then(() => setConfirmCancel(false)),
                disabled,
              }
            : {
                label: "Verwerfen",
                onClick: () => setConfirmCancel(true),
                disabled,
              }
        }
      />
    </ArnoldCard>
  );
}
