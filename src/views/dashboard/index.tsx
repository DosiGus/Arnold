import "../index.css";

import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useCallback, useEffect, useState } from "react";
import { DataLLM, useSendFollowUpMessage, useToolInfo } from "skybridge/web";
import {
  ArnoldDashboardViewSchema,
  type ArnoldDashboardView,
} from "../../shared/arnold-view.js";
import { useArnoldTool, useOpeningResult } from "../arnold-client.js";
import { onDataChanged } from "../live/data-changed.js";
import { EMPTY, viewOf } from "../demo/model.js";
import { HistoryCard, ProgressCard } from "../live/card-history.js";
import { MobilityCards } from "../live/card-mobility.js";
import {
  PlanAdjustmentCard,
  PlanChangeCard,
} from "../live/card-plan-change.js";
import { RunCards } from "../live/card-run.js";
import { DeleteCard, PairCard, WatchesCard } from "../live/card-watches.js";
import { dashboardModel } from "../model/dashboard.js";
import {
  dashboardTarget,
  openingOf,
  type DashboardTarget,
  type Opening,
} from "../model/opening.js";
import { useHostTheme } from "../use-host-theme.js";
import { AppShell } from "../onboarding/app.js";

/** Screens not wired to Arnold yet still read the POC model; empty profile. */
const PLACEHOLDER = viewOf({
  profile: { ...EMPTY },
  plan: null,
  confirmed: true,
  wearable: "open",
  done: true,
});

const Frame = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto flex w-full max-w-xl min-w-0 flex-col gap-6 overflow-x-hidden p-4">
    {children}
  </main>
);

/**
 * The card bundle of every Arnold tool except the setup. The opening answer
 * says which card the chat asked for (model/opening.ts); "Dashboard" on any
 * card leads to the overview.
 */
export default function DashboardView() {
  useHostTheme();
  const info = useToolInfo<{
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    responseMetadata: Record<string, unknown>;
  }>();
  const [overview, setOverview] = useState(false);
  if (info.isPending)
    return <p className="p-4 text-secondary">Karte wird geladen …</p>;
  const opening = openingOf(info.output, info.responseMetadata, info.input);
  if (overview || opening.kind === "dashboard")
    return <Overview focused={!overview} />;
  return (
    <Frame>
      <ChatCard opening={opening} onBack={() => setOverview(true)} />
    </Frame>
  );
}

/** A card another tool than the dashboard opened. */
function ChatCard({
  opening,
  onBack,
}: {
  opening: Exclude<Opening, { kind: "dashboard" }>;
  onBack: () => void;
}) {
  const sendFollowUp = useSendFollowUpMessage();
  const ask = (t: string) => void sendFollowUp(t);
  switch (opening.kind) {
    case "run":
      return (
        <RunCards
          card={opening.card}
          workoutId={opening.workoutId}
          onBack={onBack}
        />
      );
    case "mobility":
      return (
        <MobilityCards
          card={opening.card}
          workoutId={opening.workoutId}
          onBack={onBack}
          onAsk={ask}
        />
      );
    case "pair":
      return (
        <PairCard
          deviceLabel={opening.deviceLabel}
          confirm={opening.confirm}
          onBack={onBack}
        />
      );
    case "paired":
      return (
        <DataLLM content={`Uhr-Karte: ${opening.deviceLabel} ist verbunden.`}>
          <Alert
            color="success"
            variant="soft"
            title={`${opening.deviceLabel} ist verbunden.`}
          />
        </DataLLM>
      );
    case "pair_failed":
      return (
        <PairCard
          deviceLabel={null}
          confirm={null}
          failure={opening.message}
          onBack={onBack}
        />
      );
    case "watches":
      return <WatchesCard initial={opening.data} onBack={onBack} />;
    case "delete":
      return (
        <DeleteCard
          items={opening.items}
          confirm={opening.confirm}
          onBack={onBack}
        />
      );
    case "deleted":
      return <DeleteCard items={[]} confirm={null} deleted onBack={onBack} />;
  }
}

/**
 * `show_arnold_dashboard` and the overview behind every other card. Shows the
 * opening result, then reads the current state once more: ChatGPT may replay
 * an old result when the chat is reopened, so the card never trusts it alone.
 */
function Overview({ focused }: { focused: boolean }) {
  const sendFollowUp = useSendFollowUpMessage();
  const opening = useOpeningResult(
    "show_arnold_dashboard",
    ArnoldDashboardViewSchema,
  );
  const refresh = useArnoldTool(
    "get_arnold_dashboard",
    ArnoldDashboardViewSchema,
  );
  const [fresh, setFresh] = useState<ArnoldDashboardView | null>(null);
  const [failed, setFailed] = useState(false);
  const { call } = refresh;
  // Always with the user's zone, else Arnold cannot know what "today" is.
  const reload = useCallback(
    () =>
      call({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }).then((next) => {
        setFresh(next);
        setFailed(false);
      }),
    [call],
  );
  useEffect(() => {
    const load = () => void reload().catch(() => setFailed(true));
    load();
    // A screen saved something: read the overview again.
    return onDataChanged(load);
  }, [reload]);
  // The card the chat asked for; "Dashboard" on it leads to the overview.
  const asked =
    focused && opening.status === "ok"
      ? dashboardTarget(opening.data.focus)
      : null;
  const [left, setLeft] = useState(false);

  const view = fresh ?? (opening.status === "ok" ? opening.data : null);
  const changed = () => {
    setFailed(false);
    reload().catch(() => setFailed(true));
  };
  if (!view) {
    if (!failed)
      return <p className="p-4 text-secondary">Dashboard wird geladen …</p>;
    return (
      <Frame>
        <Alert
          color="danger"
          variant="soft"
          title="Dein Überblick lässt sich gerade nicht laden."
        />
        <Button color="secondary" variant="soft" block onClick={changed}>
          Erneut versuchen
        </Button>
      </Frame>
    );
  }
  const d = dashboardModel(view);
  const ask = (t: string) => void sendFollowUp(t);
  const card = !left && asked?.type === "card" ? asked : null;
  return (
    <Frame>
      {failed && (
        <Alert
          color="warning"
          variant="soft"
          title={
            fresh === null
              ? "Stand vom Öffnen der Karte, nicht ganz aktuell."
              : "Neu laden ging nicht, der Stand ist nicht ganz aktuell."
          }
        />
      )}
      {card ? (
        <FocusCard
          target={card}
          source={view}
          onBack={() => setLeft(true)}
          onAsk={ask}
          onChanged={changed}
        />
      ) : (
        <DataLLM
          content={`Arnold-Überblick: Woche ${d.week.done} von ${d.week.goal} Trainingstagen, ${d.goals.length} Ziele, nächstes Training ${d.next?.name ?? "keins geplant"}.`}
        >
          <AppShell
            initial={
              !left && asked?.type === "screen" ? asked.screen : "dashboard"
            }
            view={PLACEHOLDER}
            dashboard={d}
            source={view}
            onRefresh={reload}
            onAsk={ask}
            onEditProfile={() => ask("Ich möchte meine Angaben ändern.")}
          />
        </DataLLM>
      )}
    </Frame>
  );
}

function FocusCard({
  target,
  source,
  onBack,
  onAsk,
  onChanged,
}: {
  target: Extract<DashboardTarget, { type: "card" }>;
  source: ArnoldDashboardView;
  onBack: () => void;
  onAsk: (sentence: string) => void;
  onChanged: () => void;
}) {
  const props = { onBack, onAsk, onChanged };
  switch (target.card) {
    case "plan_change":
      return <PlanChangeCard {...props} />;
    case "plan_adjustment":
      return <PlanAdjustmentCard {...props} />;
    case "progress":
      return (
        <ProgressCard
          source={source}
          exerciseId={target.exerciseId}
          metric={target.metric}
          onBack={onBack}
        />
      );
    case "history":
      return (
        <HistoryCard
          source={source}
          workoutId={target.workoutId}
          onBack={onBack}
          onAsk={onAsk}
        />
      );
  }
}
