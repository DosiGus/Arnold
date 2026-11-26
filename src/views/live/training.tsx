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
  logWorkoutInput,
  newSetsOf,
  openWorkoutOf,
  proposalFor,
  resumeRows,
  rowsOf,
  trainingDayOf,
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

/** A write, or the sentence the screen shows when it failed. */
async function saved(write: () => Promise<unknown>): Promise<string | null> {
  try {
    await write();
    return null;
  } catch (e) {
    return e instanceof ArnoldCallError
      ? e.message
      : "Das Training ließ sich nicht speichern.";
  }
}

/**
 * "Training beenden" saves the ticked sets with one `log_workout`. A training
 * left open (started in the chat) is continued with `log_workout_sets` and
 * `complete_workout`.
 */
function LiveStrength({ view, kind, sessionId, onBack }: Props) {
  const sendFollowUp = useSendFollowUpMessage();
  const read = useArnoldTool("get_workout", WorkoutContextSchema);
  const log = useArnoldTool("log_workout", WriteResponseSchema);
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
          const error = await saved(() => log.call(built.input));
          if (!error) {
            dropDraft(key);
            dataChanged();
          }
          return error;
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
          const error = await saved(async () => {
            let revision = workout.row_revision;
            if (built.sets.length) {
              const res = await add.call({
                request_id: `${draft.requestId}-sets`,
                workout_id: workoutId,
                sets: built.sets,
              });
              revision = res.result?.workout?.row_revision ?? revision;
            }
            await complete.call({
              request_id: `${draft.requestId}-done`,
              workout_id: workoutId,
              expected_row_revision: revision,
            });
          });
          if (!error) {
            dropDraft(key);
            dataChanged();
          }
          return error;
        }}
      />
    </DataLLM>
  );
}
