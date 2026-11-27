import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useEffect, useRef, useState } from "react";
import { DataLLM, useSendFollowUpMessage } from "skybridge/web";
import {
  WorkoutContextSchema,
  WriteResponseSchema,
  type SessionProposal,
  type WorkoutContext,
} from "../../shared/workout-contract.js";
import { ArnoldCallError, localDate, useArnoldTool } from "../arnold-client.js";
import type { OnboardingView, PlanKind } from "../demo/model.js";
import { shortDate } from "../model/dashboard.js";
import {
  cardMessage,
  logWorkoutInput,
  newSetsOf,
  openWorkoutOf,
  proposalFor,
  resumeRows,
  rowsOf,
  savedTwinId,
  trainingDayOf,
  unusualQuestion,
  type SaveOutcome,
} from "../model/training.js";
import {
  ScreenHeader,
  TrainingScreen,
  type SetRow,
} from "../onboarding/screens.js";
import { dataChanged } from "./data-changed.js";
import { draftOf, dropDraft } from "./drafts.js";
import { LiveMobilityScreen } from "./mobility.js";

type Props = {
  view: OnboardingView;
  kind: PlanKind;
  sessionId: string | null;
  onBack: () => void;
};

/**
 * The training screen on Arnold's data: strength from `get_workout`, morning
 * routine and mobility from `get_mobility_overview`. Runs are recorded by the
 * watch or told in the chat.
 */
export function LiveTrainingScreen(props: Props) {
  const sendFollowUp = useSendFollowUpMessage();
  if (props.kind === "strength") return <LiveStrength {...props} />;
  if (props.kind !== "run")
    return <LiveMobilityScreen kind={props.kind} onBack={props.onBack} />;
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader title="Lauf" onBack={props.onBack} />
      <p className="m-0 text-secondary">
        Läufe zeichnet deine Uhr auf, oder du erzählst sie im Chat.
      </p>
      <Button
        color="primary"
        block
        onClick={() => void sendFollowUp("Zeig mir meinen heutigen Lauf.")}
      >
        Heutigen Lauf ansehen
      </Button>
    </div>
  );
}

const failureText = (e: unknown) =>
  e instanceof ArnoldCallError
    ? cardMessage(e.message)
    : "Das Training ließ sich nicht speichern.";

const refusedAs = (e: unknown, code: string) =>
  e instanceof ArnoldCallError && e.code === code;

/** Unusual values are stored only after the explicit yes. */
const askUnusual = (
  question: string,
  confirmed: () => Promise<SaveOutcome>,
): SaveOutcome => ({
  question,
  choices: [
    { label: "Ja, so speichern", kind: "primary", run: confirmed },
    { label: "Wert ändern", kind: "soft" },
  ],
});

/**
 * "Training beenden" saves the ticked sets with one `log_workout`. A training
 * left open (started in the chat) is continued with `log_workout_sets` and
 * `complete_workout`.
 */
function LiveStrength({ view, kind, sessionId, onBack }: Props) {
  const sendFollowUp = useSendFollowUpMessage();
  const read = useArnoldTool("get_workout", WorkoutContextSchema);
  const log = useArnoldTool("log_workout", WriteResponseSchema);
  const cancel = useArnoldTool("cancel_workout", WriteResponseSchema);
  /** Discarding an open training takes a second tap. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discardFailed, setDiscardFailed] = useState<string | null>(null);
  const discardId = useRef(crypto.randomUUID());
  const [context, setContext] = useState<WorkoutContext | null>(null);
  const [failed, setFailed] = useState(false);
  /** Answer to "continue the open training?"; null while not asked. */
  const [resume, setResume] = useState<boolean | null>(null);
  /** The session on screen: saving moves `sessionId` on to the next one. */
  const shown = useRef<string | null>(null);
  const { call } = read;
  useEffect(() => {
    call()
      .then(setContext)
      .catch(() => setFailed(true));
  }, [call]);

  const message = (children: React.ReactNode) => (
    <div className="flex flex-col gap-4">
      <ScreenHeader title="Training" onBack={onBack} />
      {children}
    </div>
  );
  if (failed)
    return message(
      <Alert
        color="danger"
        variant="soft"
        title="Dein Training lässt sich gerade nicht laden."
      />,
    );
  if (!context)
    return message(
      <p className="m-0 text-secondary">Training wird geladen …</p>,
    );

  const open = openWorkoutOf(context);
  const openProposal = open
    ? context.proposals.find((p) => p.session_id === open.session_id)
    : undefined;
  if (open && openProposal) {
    if (resume === null)
      return message(
        <>
          <p className="m-0 text-secondary">
            Du hast ein offenes Training vom{" "}
            {shortDate(open.workout_date_local)} ({openProposal.session_name}).
          </p>
          <Button color="primary" block onClick={() => setResume(true)}>
            Fortsetzen
          </Button>
          <Button
            color="secondary"
            variant="soft"
            block
            onClick={() => setResume(false)}
          >
            Neues Training
          </Button>
          <Button
            color="danger"
            variant={confirmDiscard ? "soft" : "ghost"}
            block
            loading={cancel.pending}
            onClick={() => {
              if (!confirmDiscard) return setConfirmDiscard(true);
              setDiscardFailed(null);
              cancel
                .call({
                  request_id: discardId.current,
                  workout_id: open.workout_id,
                  expected_row_revision: open.row_revision,
                })
                .then(() => {
                  dropDraft(`resume:${open.workout_id}`);
                  dataChanged();
                  return call().then(setContext);
                })
                .catch((e) => {
                  setDiscardFailed(failureText(e));
                })
                .finally(() => setConfirmDiscard(false));
            }}
          >
            {confirmDiscard ? "Wirklich verwerfen?" : "Offenes verwerfen"}
          </Button>
          {discardFailed && (
            <Alert color="danger" variant="soft" title={discardFailed} />
          )}
        </>,
      );
    if (resume)
      return (
        <ResumedTraining
          view={view}
          kind={kind}
          onBack={onBack}
          workoutId={open.workout_id}
          proposal={openProposal}
        />
      );
  }

  const proposal = proposalFor(context, shown.current ?? sessionId);
  shown.current ??= proposal?.session_id ?? null;
  if (!proposal)
    return message(
      <>
        <p className="m-0 text-secondary">
          Dein Plan hat gerade keine Krafteinheit.
        </p>
        <Button
          color="secondary"
          variant="soft"
          block
          onClick={() => void sendFollowUp("Was steht heute an?")}
        >
          Im Chat fragen
        </Button>
      </>,
    );
  const key = `workout:${localDate()}:${proposal.plan_version_id}:${proposal.session_id}`;
  const draft = draftOf<Record<string, SetRow[]>>(key);
  return (
    <DataLLM content={cardText(proposal)}>
      <TrainingScreen
        view={view}
        kind={kind}
        onBack={onBack}
        liveDay={trainingDayOf(proposal)}
        initialRows={draft.value ?? rowsOf(proposal)}
        onRowsChange={(rows) => {
          draft.value = rows;
        }}
        onFinish={async (rows) => {
          const built = logWorkoutInput(proposal, rows, {
            requestId: draft.requestId,
            date: localDate(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
          if (!built.ok) return built.error;
          // Every answer of the user is a new input with its own request id.
          const attempt = async (
            extra: Record<string, unknown>,
            answered: string,
          ): Promise<SaveOutcome> => {
            try {
              await log.call({
                ...built.input,
                ...extra,
                request_id: `${draft.requestId}${answered}`,
              });
              dropDraft(key);
              dataChanged();
              return null;
            } catch (e) {
              if (refusedAs(e, "CONFIRMATION_REQUIRED"))
                return askUnusual(unusualQuestion(proposal, rows), () =>
                  attempt(
                    { ...extra, confirm_unusual_values: true },
                    `${answered}-unusual`,
                  ),
                );
              if (refusedAs(e, "DUPLICATE_WORKOUT"))
                return askDuplicate(
                  (e as ArnoldCallError).details,
                  extra,
                  answered,
                );
              return failureText(e);
            }
          };
          const askDuplicate = async (
            details: readonly string[],
            extra: Record<string, unknown>,
            answered: string,
          ): Promise<SaveOutcome> => {
            const id = savedTwinId(details);
            // Replacing needs the saved training's current revision.
            let twin: WorkoutContext["workout"] = null;
            try {
              if (id) twin = (await call({ workout_id: id })).workout;
            } catch (e) {
              return failureText(e);
            }
            const replace = twin && {
              label: "Gespeichertes ersetzen",
              kind: "primary" as const,
              run: () =>
                attempt(
                  {
                    ...extra,
                    replaces_workout_id: twin.workout_id,
                    expected_row_revision: twin.row_revision,
                  },
                  `${answered}-replace`,
                ),
            };
            return {
              question: `„${proposal.session_name}“ ist für heute schon gespeichert.`,
              choices: [
                ...(replace ? [replace] : []),
                {
                  label: "Zusätzlich speichern",
                  kind: "soft",
                  run: () =>
                    attempt(
                      { ...extra, confirm_duplicate: true },
                      `${answered}-again`,
                    ),
                },
                { label: "Abbrechen", kind: "ghost" },
              ],
            };
          };
          return attempt({}, "");
        }}
      />
    </DataLLM>
  );
}

const cardText = (proposal: SessionProposal) =>
  `Trainingskarte: ${proposal.session_name} mit ${proposal.exercises.length} Übungen, Werte aus Arnolds Vorschlag.`;

function ResumedTraining({
  view,
  kind,
  onBack,
  workoutId,
  proposal,
}: {
  view: OnboardingView;
  kind: PlanKind;
  onBack: () => void;
  workoutId: string;
  proposal: SessionProposal;
}) {
  const read = useArnoldTool("get_workout", WorkoutContextSchema);
  const add = useArnoldTool("log_workout_sets", WriteResponseSchema);
  const complete = useArnoldTool("complete_workout", WriteResponseSchema);
  const [context, setContext] = useState<WorkoutContext | null>(null);
  const [failed, setFailed] = useState(false);
  const { call } = read;
  useEffect(() => {
    call({ workout_id: workoutId })
      .then(setContext)
      .catch(() => setFailed(true));
  }, [call, workoutId]);
  const workout = context?.workout;
  if (failed || (context && !workout))
    return (
      <Alert
        color="danger"
        variant="soft"
        title="Dein Training lässt sich gerade nicht laden."
      />
    );
  if (!context || !workout)
    return <p className="m-0 text-secondary">Training wird geladen …</p>;
  const key = `resume:${workoutId}`;
  const draft = draftOf<Record<string, SetRow[]>>(key);
  return (
    <DataLLM content={cardText(proposal)}>
      <TrainingScreen
        view={view}
        kind={kind}
        onBack={onBack}
        liveDay={trainingDayOf(proposal)}
        initialRows={draft.value ?? resumeRows(proposal, context.sets)}
        notice={`Fortgesetzt: Training vom ${shortDate(workout.workout_date_local)} – grau abgehakte Sätze sind schon gespeichert.`}
        onRowsChange={(rows) => {
          draft.value = rows;
        }}
        onFinish={async (rows) => {
          const built = newSetsOf(proposal, rows);
          if (!built.ok) return built.error;
          const attempt = async (confirmed: boolean): Promise<SaveOutcome> => {
            try {
              let revision = workout.row_revision;
              if (built.sets.length) {
                const res = await add.call({
                  request_id: `${draft.requestId}-sets${confirmed ? "-unusual" : ""}`,
                  workout_id: workoutId,
                  sets: built.sets,
                  ...(confirmed ? { confirm_unusual_values: true } : {}),
                });
                revision = res.result?.workout?.row_revision ?? revision;
              }
              await complete.call({
                request_id: `${draft.requestId}-done`,
                workout_id: workoutId,
                expected_row_revision: revision,
              });
              dropDraft(key);
              dataChanged();
              return null;
            } catch (e) {
              return refusedAs(e, "CONFIRMATION_REQUIRED")
                ? askUnusual(unusualQuestion(proposal, rows), () =>
                    attempt(true),
                  )
                : failureText(e);
            }
          };
          return attempt(false);
        }}
      />
    </DataLLM>
  );
}
