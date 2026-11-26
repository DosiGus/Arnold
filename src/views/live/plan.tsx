import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { useEffect, useState } from "react";
import { DataLLM } from "skybridge/web";
import {
  PlanCardSchema,
  type PlanCard,
} from "../../shared/onboarding-contract.js";
import {
  RunWeekResponseSchema,
  type RunWeekResponse,
} from "../../shared/run-contract.js";
import { useArnoldTool } from "../arnold-client.js";
import type { OnboardingView } from "../demo/model.js";
import { cardPlanFrom, cardProfileOf } from "../model/onboarding.js";
import { withRunWeek } from "../model/plan-runs.js";
import { PlanScreen } from "../onboarding/screens.js";

/**
 * The plan screen on Arnold's real plan: reads `get_plan_card` (app only)
 * when it opens. Design and layout are the template's PlanScreen.
 */
export function LivePlanScreen({
  view,
  onBack,
  onAsk,
}: {
  view: OnboardingView;
  onBack: () => void;
  onAsk: (sentence: string) => void;
}) {
  const { call } = useArnoldTool("get_plan_card", PlanCardSchema);
  const [card, setCard] = useState<PlanCard | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    call()
      .then(setCard)
      .catch(() => setFailed(true));
  }, [call]);
  // Days and lengths of the runs; the plan shows without them too.
  const runs = useArnoldTool("get_run_week", RunWeekResponseSchema);
  const [week, setWeek] = useState<RunWeekResponse | null>(null);
  const hasRuns = !!card?.plan?.run_sessions?.length;
  const readWeek = runs.call;
  useEffect(() => {
    if (!hasRuns) return;
    readWeek({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      .then(setWeek)
      .catch(() => setWeek(null));
  }, [hasRuns, readWeek]);

  if (failed)
    return (
      <Alert
        color="danger"
        variant="soft"
        title="Dein Plan lässt sich gerade nicht laden."
      />
    );
  if (!card) return <p className="m-0 text-secondary">Plan wird geladen …</p>;
  const stored = cardPlanFrom(
    card.plan,
    card.plan_insights,
    card.load_estimates,
  );
  const plan = stored && week ? withRunWeek(stored, week) : stored;
  const live: OnboardingView = {
    ...view,
    plan,
    profile: card.profile ? cardProfileOf(card.profile) : view.profile,
  };
  return (
    <DataLLM
      content={
        card.plan
          ? `Plan-Karte: ${card.plan.name}, ${card.plan.session_count} Trainingseinheiten, Status ${card.plan.status}.`
          : "Plan-Karte: noch kein Trainingsplan."
      }
    >
      <PlanScreen view={live} onBack={onBack} onAsk={onAsk} />
    </DataLLM>
  );
}
