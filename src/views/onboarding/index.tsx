import "../index.css";

import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Animate } from "@openai/apps-sdk-ui/components/Transition";
import { useState } from "react";
import {
  DataLLM,
  useOpenExternal,
  useSendFollowUpMessage,
} from "skybridge/web";
import {
  OnboardingViewSchema,
  type OnboardingState,
} from "../../shared/onboarding-contract.js";
import { useOpeningResult } from "../arnold-client.js";
import { useHostTheme } from "../use-host-theme.js";
import { AppShell } from "./app.js";
import type { Screen } from "./dashboard.js";
import { Stepper } from "./parts.js";
import {
  Building,
  Done,
  GARMIN_STORE_URL,
  OwnPlan,
  PlanStep,
  ProfileStep,
  WearableStep,
  Welcome,
} from "./steps.js";
import { useSetup } from "./use-setup.js";
import { WatchPairing } from "../live/watch-pairing.js";

const STEP_INDEX = {
  welcome: 0,
  profile: 1,
  plan: 2,
  wearable: 3,
  done: 4,
} as const;

/** View of `show_arnold_onboarding`: the setup against Arnold's service. */
export default function Onboarding() {
  useHostTheme();
  const opening = useOpeningResult(
    "show_arnold_onboarding",
    OnboardingViewSchema,
  );
  if (opening.status === "pending")
    return <p className="p-4 text-secondary">Arnold wird geladen …</p>;
  if (opening.status === "error")
    return (
      <main className="mx-auto w-full max-w-xl p-4">
        <Alert color="danger" variant="soft" title={opening.error.message} />
      </main>
    );
  return <Flow initial={opening.data.state} />;
}

function Flow({ initial }: { initial: OnboardingState }) {
  const sendFollowUp = useSendFollowUpMessage();
  const s = useSetup(initial, (t) => sendFollowUp(t));
  const [screen, setScreen] = useState<"setup" | Screen>("setup");
  // "Angaben ändern" while a plan is under review: the answers are shown
  // again; the stored status stays until a new plan is asked for.
  const [editing, setEditing] = useState(false);
  const [pairedWatch, setPairedWatch] = useState<string | null>(null);
  const openExternal = useOpenExternal();
  const { view } = s;

  const missing = view.required
    .filter((r) => r.value === null)
    .map((r) => r.label);
  const context = `Arnold-Einrichtung, Schritt "${view.phase}". ${view.answered} von ${view.total} Pflichtangaben. ${missing.length ? `Es fehlt noch: ${missing.join(", ")}.` : "Alle Pflichtangaben da."}${s.building ? " Arnold wartet auf den Planvorschlag von ChatGPT." : ""}`;

  const phase = editing && view.phase === "plan" ? "profile" : view.phase;
  const key = s.building
    ? "building"
    : view.profile.path === "own_plan" && phase === "profile"
      ? "own"
      : phase;

  if (screen !== "setup")
    return (
      <DataLLM content="Arnold-Überblick nach der Einrichtung.">
        <main className="mx-auto flex w-full max-w-xl min-w-0 flex-col gap-6 overflow-x-hidden p-4">
          <AppShell
            live
            initial={screen}
            view={view}
            onAsk={(t) => void sendFollowUp(t)}
            onEditProfile={() =>
              void sendFollowUp("Ich möchte meine Angaben ändern.")
            }
          />
        </main>
      </DataLLM>
    );

  return (
    <DataLLM content={context}>
      <main className="mx-auto flex w-full max-w-xl min-w-0 flex-col gap-6 overflow-x-hidden p-4">
        <Stepper
          index={STEP_INDEX[phase]}
          complete={phase === "done"}
          onStep={(i) => {
            if (i === 2) return setEditing(false);
            if (i === 1 && view.phase === "plan") return setEditing(true);
            if (view.phase === "profile" || view.phase === "welcome")
              void s.goTo(i === 0 ? "welcome" : "profile");
          }}
        />

        {s.error && <Alert color="danger" variant="soft" title={s.error} />}

        <Animate
          initial={{ opacity: 0, y: 10 }}
          enter={{ opacity: 1, y: 0, duration: 280 }}
          exit={{ opacity: 0, duration: 100 }}
        >
          <div key={key}>
            {key === "building" && (
              <div className="flex flex-col gap-3">
                <Building />
                {s.slow && (
                  <div className="flex flex-col gap-2">
                    <p className="m-0 text-sm text-secondary">
                      Das dauert länger als sonst. Bitte ChatGPT im Chat, den
                      Plan zu erstellen.
                    </p>
                    <Button
                      color="secondary"
                      variant="soft"
                      block
                      onClick={s.askAgain}
                    >
                      Noch einmal anfragen
                    </Button>
                  </div>
                )}
              </div>
            )}
            {key === "welcome" && <Welcome update={s.update} />}
            {key === "own" && <OwnPlan update={s.update} />}
            {key === "profile" && (
              <ProfileStep
                view={view}
                busy={s.busy}
                update={s.update}
                onCreate={() => {
                  setEditing(false);
                  void s.createPlan();
                }}
              />
            )}
            {key === "plan" && (
              <PlanStep
                view={view}
                busy={s.busy}
                onConfirm={() => void s.confirmPlan()}
                onRebuild={() => void s.createPlan()}
                onBack={() => setEditing(true)}
                onAsk={(t) => void sendFollowUp(t)}
              />
            )}
            {key === "wearable" && (
              <WearableStep
                view={view}
                busy={s.busy}
                onChoose={(c) =>
                  void s.finish().then((ok) => {
                    if (!ok) return;
                    s.chooseWearable(c);
                  })
                }
                onFinish={() => s.chooseWearable("later")}
                onOpenStore={() => openExternal(GARMIN_STORE_URL)}
                pairing={
                  pairedWatch ? (
                    <Alert
                      color="success"
                      variant="soft"
                      title={`${pairedWatch} ist mit Arnold verbunden.`}
                      description="Die Uhr lädt deinen Plan in wenigen Sekunden."
                    />
                  ) : (
                    <WatchPairing onPaired={setPairedWatch} />
                  )
                }
              />
            )}
            {key === "done" && (
              <Done
                view={view}
                onNext={() => setScreen("training")}
                onDashboard={() => setScreen("dashboard")}
                onSettings={() => setScreen("settings")}
              />
            )}
          </div>
        </Animate>
      </main>
    </DataLLM>
  );
}
