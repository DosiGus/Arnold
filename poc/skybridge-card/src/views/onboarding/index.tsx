import "../../index.css";

import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { ArrowRotateCcw } from "@openai/apps-sdk-ui/components/Icon";
import { Animate } from "@openai/apps-sdk-ui/components/Transition";
import { DataLLM, useSendFollowUpMessage } from "skybridge/web";
import type { OnboardingView } from "../../onboarding/model.js";
import { useToolInfo } from "../../helpers.js";
import { useHostTheme } from "../../use-host-theme.js";
import { Stepper } from "./parts.js";
import {
  Building,
  Done,
  OwnPlan,
  PlanStep,
  ProfileStep,
  WearableStep,
  Welcome,
} from "./steps.js";
import { useSetup } from "./use-setup.js";

const STEP_INDEX = {
  welcome: 0,
  profile: 1,
  plan: 2,
  wearable: 3,
  done: 4,
} as const;

export default function Onboarding() {
  useHostTheme();
  const info = useToolInfo<"show_onboarding">();
  if (info.isPending)
    return <p className="p-4 text-secondary">Arnold wird geladen …</p>;
  return <Flow initial={info.output.state as OnboardingView} />;
}

function Flow({ initial }: { initial: OnboardingView }) {
  const s = useSetup(initial);
  const sendFollowUp = useSendFollowUpMessage();
  const { view } = s;
  const building = s.busy === "plan";

  const missing = view.required
    .filter((r) => r.value === null)
    .map((r) => r.label);
  const context = `Einrichtung, Schritt "${view.phase}". Ziel: ${view.profile.goal ?? "fehlt"}, Tage: ${view.profile.days ?? "fehlt"}, Minuten: ${view.profile.minutes ?? "fehlt"}. ${missing.length ? `Es fehlt noch: ${missing.join(", ")}.` : "Alle Pflichtangaben da."}`;

  const key = building
    ? "building"
    : view.profile.path === "own_plan" && view.phase === "profile"
      ? "own"
      : view.phase;

  return (
    <DataLLM content={context}>
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Stepper index={STEP_INDEX[view.phase]} />
          </div>
          <Button
            color="secondary"
            variant="ghost"
            size="sm"
            uniform
            aria-label="Einrichtung zurücksetzen (nur Test)"
            onClick={() => void s.reset()}
          >
            <ArrowRotateCcw className="size-4" />
          </Button>
        </div>

        {s.error && <Alert color="danger" variant="soft" title={s.error} />}

        <Animate
          initial={{ opacity: 0, y: 10 }}
          enter={{ opacity: 1, y: 0, duration: 280 }}
          exit={{ opacity: 0, duration: 100 }}
        >
          <div key={key}>
            {key === "building" && <Building />}
            {key === "welcome" && <Welcome update={s.update} />}
            {key === "own" && <OwnPlan update={s.update} />}
            {key === "profile" && (
              <ProfileStep
                view={view}
                busy={s.busy}
                update={s.update}
                onCreate={() => void s.createPlan()}
              />
            )}
            {key === "plan" && (
              <PlanStep
                view={view}
                busy={s.busy}
                onConfirm={() => void s.confirmPlan()}
                onRebuild={() => void s.createPlan()}
                onBack={() => s.update({ days: view.profile.days })}
              />
            )}
            {key === "wearable" && (
              <WearableStep
                view={view}
                busy={s.busy}
                onChoose={(c) =>
                  void s
                    .chooseWearable(c)
                    .then(() => (c === "later" ? s.finish() : undefined))
                }
                onFinish={() => void s.finish()}
              />
            )}
            {key === "done" && (
              <Done
                view={view}
                onNext={() =>
                  void sendFollowUp("Zeig mir mein nächstes Training.")
                }
              />
            )}
          </div>
        </Animate>
      </main>
    </DataLLM>
  );
}
