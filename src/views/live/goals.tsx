import { DataLLM } from "skybridge/web";
import type { ArnoldDashboardView } from "../../shared/arnold-view.js";
import { WriteResponseSchema } from "../../shared/workout-contract.js";
import {
  ArnoldCallError,
  localDate,
  newRequestId,
  useArnoldTool,
} from "../arnold-client.js";
import {
  archiveGoalInput,
  bodyWeightInput,
  createGoalInput,
  goalChoices,
  goalErrorText,
  goalRows,
  latestWeightText,
  placeholderFor,
  unitsFor,
  updateGoalInput,
  voidWeightInput,
} from "../model/goals.js";
import { GoalsScreen } from "../onboarding/screens.js";

/**
 * The goals screen on Arnold's goals: the list comes from the dashboard
 * answer, the forms write with create/update/archive_training_goal and
 * log_body_weight and void_body_weight, and the dashboard is read again after
 * every write so list and overview agree.
 */
export function LiveGoalsScreen({
  source,
  onBack,
  onRefresh,
}: {
  source: ArnoldDashboardView;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}) {
  const create = useArnoldTool("create_training_goal", WriteResponseSchema);
  const update = useArnoldTool("update_training_goal", WriteResponseSchema);
  const archive = useArnoldTool("archive_training_goal", WriteResponseSchema);
  const weigh = useArnoldTool("log_body_weight", WriteResponseSchema);
  const discard = useArnoldTool("void_body_weight", WriteResponseSchema);

  const write = async (
    call: (args: Record<string, unknown>) => Promise<unknown>,
    built:
      | { ok: true; input: Record<string, unknown> }
      | { ok: false; error: string },
  ): Promise<string | null> => {
    if (!built.ok) return built.error;
    try {
      await call(built.input);
      await onRefresh().catch(() => undefined);
      return null;
    } catch (e) {
      if (e instanceof ArnoldCallError) {
        if (e.code === "REVISION_CONFLICT")
          await onRefresh().catch(() => undefined);
        return goalErrorText(e.code, e.message);
      }
      return "Das ließ sich nicht speichern.";
    }
  };

  const goals = goalRows(source.home);
  return (
    <DataLLM
      content={`Ziele-Karte: ${goals.length} aktive Ziele${goals.length ? ` (${goals.map((g) => g.name).join(", ")})` : ""}.`}
    >
      <GoalsScreen
        onBack={onBack}
        live={{
          goals,
          latestWeight: latestWeightText(source),
          onVoidWeight: () => {
            const input = voidWeightInput(source, newRequestId());
            return input
              ? write(discard.call, { ok: true, input })
              : Promise.resolve(null);
          },
          onLogWeight: (text) =>
            write(
              weigh.call,
              bodyWeightInput(text, {
                requestId: newRequestId(),
                date: localDate(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }),
            ),
          choices: goalChoices(source),
          unitsFor,
          placeholderFor,
          onCreate: (form) =>
            write(create.call, createGoalInput(form, newRequestId())),
          onUpdate: (goal, target) =>
            write(update.call, updateGoalInput(goal, target, newRequestId())),
          onArchive: (goal) =>
            write(archive.call, {
              ok: true,
              input: archiveGoalInput(goal, newRequestId()),
            }),
        }}
      />
    </DataLLM>
  );
}
