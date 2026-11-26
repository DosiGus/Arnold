import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useCallback, useEffect, useState } from "react";
import {
  ArnoldDashboardViewSchema,
  type ArnoldDashboardView,
} from "../../shared/arnold-view.js";
import { HealthDataSchema } from "../../shared/health-contract.js";
import { useArnoldTool } from "../arnold-client.js";
import { onDataChanged } from "../live/data-changed.js";
import { dashboardModel } from "../model/dashboard.js";
import type { OnboardingView, PlanKind } from "../demo/model.js";
import { Dashboard, type Screen } from "./dashboard.js";
import { LivePlanScreen } from "../live/plan.js";
import { LiveTrainingScreen } from "../live/training.js";
import { LiveGoalsScreen } from "../live/goals.js";
import { LiveStatsScreen } from "../live/stats.js";
import { LiveHealthScreen } from "../live/health.js";
import { LiveSettingsScreen } from "../live/settings.js";
import type { DashboardData } from "../demo/dashboard.js";
import { recordsScreenModel, runRecordsScreenModel } from "../model/records.js";
import { RecordsScreen, ScreenHeader } from "./screens.js";

const SCREEN_TITLE: Partial<Record<Screen, string>> = {
  records: "Rekorde",
  goals: "Ziele",
  stats: "Trainingsentwicklung",
};

/**
 * What stands where Arnold's figures belong until they are there: loading, or
 * the error with a retry. Never a stand-in figure.
 */
export function Waiting({
  screen,
  failed,
  onRetry,
  onBack,
}: {
  screen: Screen;
  failed: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const title = SCREEN_TITLE[screen];
  return (
    <div className="flex flex-col gap-4">
      {title && <ScreenHeader title={title} onBack={onBack} />}
      {failed ? (
        <>
          <Alert
            color="danger"
            variant="soft"
            title="Deine Daten lassen sich gerade nicht laden."
          />
          <Button color="secondary" variant="soft" block onClick={onRetry}>
            Noch einmal versuchen
          </Button>
        </>
      ) : (
        <p className="m-0 text-secondary">Wird geladen …</p>
      )}
    </div>
  );
}

/** Everything after the setup: dashboard and the screens it opens. */
export function AppShell({
  view,
  onAsk,
  onEditProfile,
  initial = "dashboard",
  dashboard: givenDashboard,
  source: givenSource,
  onRefresh: givenRefresh,
}: {
  /** The overview figures, when the view already has them. */
  dashboard?: DashboardData;
  /** The dashboard answer those figures come from. */
  source?: ArnoldDashboardView;
  /** Reads the dashboard again (after a write on a screen). */
  onRefresh?: () => Promise<void>;
  initial?: Screen;
  view: OnboardingView;
  onAsk: (sentence: string) => void;
  /** Back to the setup form (or, in the standalone view, a chat sentence). */
  onEditProfile: () => void;
}) {
  // Without a dashboard answer (the shell after the setup) it is read here.
  const own = !givenSource;
  const { call } = useArnoldTool(
    "get_arnold_dashboard",
    ArnoldDashboardViewSchema,
  );
  const [loaded, setLoaded] = useState<ArnoldDashboardView | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    setFailed(false);
    return call({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      .then(setLoaded)
      .catch(() => setFailed(true));
  }, [call]);
  useEffect(() => {
    if (!own) return;
    void reload();
    // A screen saved something: read the overview again.
    return onDataChanged(() => void reload());
  }, [own, reload]);
  const source = givenSource ?? loaded ?? undefined;
  const dashboard =
    givenDashboard ?? (source ? dashboardModel(source) : undefined);
  const onRefresh = givenRefresh ?? reload;

  // Health Data is offered only where values can come for this account.
  const { call: readHealth } = useArnoldTool(
    "get_health_data",
    HealthDataSchema,
  );
  const [health, setHealth] = useState(false);
  useEffect(() => {
    readHealth({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      .then((d) => setHealth(d.status !== "not_connected"))
      // Unknown means not offered; the rest of the overview works without it.
      .catch(() => setHealth(false));
  }, [readHealth]);

  const [screen, setScreen] = useState<Screen>(initial);
  const [kind, setKind] = useState<PlanKind>("strength");
  const go = (next: Screen, k?: PlanKind) => {
    if (k) setKind(k);
    setScreen(next);
  };
  const back = () => setScreen("dashboard");
  const waiting = (
    <Waiting
      screen={screen}
      failed={failed}
      onRetry={() => void reload()}
      onBack={back}
    />
  );
  return (
    <div key={screen} className="flex flex-col gap-4">
      {own && failed && source && (
        <Alert
          color="warning"
          variant="soft"
          title="Der Stand ließ sich nicht neu laden und ist nicht ganz aktuell."
        />
      )}
      {screen === "dashboard" &&
        (dashboard ? (
          <Dashboard d={dashboard} health={health} onAsk={onAsk} go={go} />
        ) : (
          waiting
        ))}
      {screen === "plan" && (
        <LivePlanScreen view={view} onBack={back} onAsk={onAsk} />
      )}
      {screen === "training" && (
        <LiveTrainingScreen
          view={view}
          kind={kind}
          sessionId={dashboard?.next?.sessionId ?? null}
          onBack={back}
        />
      )}
      {screen === "records" &&
        (source ? (
          <RecordsScreen
            onBack={back}
            records={recordsScreenModel(source.home)}
            runRecords={runRecordsScreenModel(source.home)}
          />
        ) : (
          waiting
        ))}
      {screen === "goals" &&
        (source ? (
          <LiveGoalsScreen
            source={source}
            onBack={back}
            onRefresh={onRefresh}
          />
        ) : (
          waiting
        ))}
      {screen === "stats" &&
        (source ? <LiveStatsScreen source={source} onBack={back} /> : waiting)}
      {screen === "health" && (
        <LiveHealthScreen onBack={back} onConsent={() => go("settings")} />
      )}
      {screen === "settings" && (
        <LiveSettingsScreen
          view={view}
          watchDelivery={source?.watch_delivery}
          onBack={back}
          onEditProfile={onEditProfile}
        />
      )}
    </div>
  );
}
