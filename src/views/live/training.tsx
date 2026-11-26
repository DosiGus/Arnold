import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { useEffect, useState } from "react";
import { DataLLM } from "skybridge/web";
import {
  WorkoutContextSchema,
  WriteResponseSchema,
  type WorkoutContext,
} from "../../shared/workout-contract.js";
import {
  ArnoldCallError,
  localDate,
  newRequestId,
  useArnoldTool,
} from "../arnold-client.js";
import type { OnboardingView, PlanKind } from "../demo/model.js";
import {
  logWorkoutInput,
  proposalFor,
  rowsOf,
  trainingDayOf,
} from "../model/training.js";
import { TrainingScreen } from "../onboarding/screens.js";

/**
 * The training screen on Arnold's proposal for the next session: weights and
 * repetitions from `get_workout`, "Training beenden" saves the ticked sets
 * with one `log_workout`. Mobility and morning keep the template checklist.
 */
export function LiveTrainingScreen({
  view,
  kind,
  sessionId,
  onBack,
}: {
  view: OnboardingView;
  kind: PlanKind;
  sessionId: string | null;
  onBack: () => void;
}) {
  const read = useArnoldTool("get_workout", WorkoutContextSchema);
  const log = useArnoldTool("log_workout", WriteResponseSchema);
  const [context, setContext] = useState<WorkoutContext | null>(null);
  const [failed, setFailed] = useState(false);
  const { call } = read;
  useEffect(() => {
    if (kind !== "strength") return;
    call()
      .then(setContext)
      .catch(() => setFailed(true));
  }, [call, kind]);

  if (kind !== "strength")
    return <TrainingScreen view={view} kind={kind} onBack={onBack} />;
  if (failed)
    return (
      <Alert
        color="danger"
        variant="soft"
        title="Dein Training lässt sich gerade nicht laden."
      />
    );
  if (!context)
    return <p className="m-0 text-secondary">Training wird geladen …</p>;
  const proposal = proposalFor(context, sessionId);
  if (!proposal)
    return (
      <TrainingScreen
        view={{ ...view, plan: null }}
        kind={kind}
        onBack={onBack}
      />
    );
  return (
    <DataLLM
      content={`Trainingskarte: ${proposal.session_name} mit ${proposal.exercises.length} Übungen, Werte aus Arnolds Vorschlag.`}
    >
      <TrainingScreen
        view={view}
        kind={kind}
        onBack={onBack}
        liveDay={trainingDayOf(proposal)}
        initialRows={rowsOf(proposal)}
        onFinish={async (rows) => {
          const built = logWorkoutInput(proposal, rows, {
            requestId: newRequestId(),
            date: localDate(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
          if (!built.ok) return built.error;
          try {
            await log.call(built.input);
            return null;
          } catch (e) {
            return e instanceof ArnoldCallError
              ? e.message
              : "Das Training ließ sich nicht speichern.";
          }
        }}
      />
    </DataLLM>
  );
}
