import { useCallback, useEffect, useState } from "react";
import {
  ArnoldDashboardViewSchema,
  type ArnoldDashboardView,
} from "../../shared/arnold-view.js";
import { useArnoldTool } from "../arnold-client.js";
import { dashboardModel } from "../model/dashboard.js";
import type { OnboardingView, PlanKind } from "../demo/model.js";
import { Dashboard, type Screen } from "./dashboard.js";
import { LivePlanScreen } from "../live/plan.js";
import { LiveTrainingScreen } from "../live/training.js";
import { LiveGoalsScreen } from "../live/goals.js";
import { LiveStatsScreen } from "../live/stats.js";
import { LiveHealthScreen } from "../live/health.js";
import { LiveSettingsScreen } from "../live/settings.js";
import { dashboardOf, type DashboardData } from "../demo/dashboard.js";
import { recordsScreenModel } from "../model/records.js";
import {
  GoalsScreen,
  HealthScreen,
  PlanScreen,
  RecordsScreen,
  SettingsScreen,
  StatsScreen,
  TrainingScreen,
} from "./screens.js";

/** Everything after the setup: dashboard and the screens it opens. */
export function AppShell({
  view,
  onAsk,
  onEditProfile,
  initial = "dashboard",
  dashboard: givenDashboard,
  source: givenSource,
  onRefresh: givenRefresh,
  live = false,
}: {
  /** Screens read Arnold's real data where they are wired up. */
  live?: boolean;
  /** Real overview figures; without them the POC sample figures are shown. */
  dashboard?: DashboardData;
  /** The dashboard answer the real figures come from (live mode). */
  source?: ArnoldDashboardView;
  /** Reads the dashboard again (after a write on a screen). */
  onRefresh?: () => Promise<void>;
  initial?: Screen;
  view: OnboardingView;
  onAsk: (sentence: string) => void;
  /** Back to the setup form (or, in the standalone view, a chat sentence). */
  onEditProfile: () => void;
}) {
  // Live without a dashboard answer (the shell after the setup): read it
  // here, so overview, records, goals and progress show real figures too.
  const own = !givenSource && live;
  const { call } = useArnoldTool(
    "get_arnold_dashboard",
    ArnoldDashboardViewSchema,
  );
  const [loaded, setLoaded] = useState<ArnoldDashboardView | null>(null);
  const reload = useCallback(
    () =>
      call({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
        .then(setLoaded)
        .catch(() => undefined),
    [call],
  );
  useEffect(() => {
    if (own) void reload();
  }, [own, reload]);
  const source = givenSource ?? loaded ?? undefined;
  const dashboard =
    givenDashboard ?? (own && loaded ? dashboardModel(loaded) : undefined);
  const onRefresh = givenRefresh ?? (own ? reload : async () => undefined);
  const [screen, setScreen] = useState<Screen>(initial);
  const [kind, setKind] = useState<PlanKind>("strength");
  const go = (next: Screen, k?: PlanKind) => {
    if (k) setKind(k);
    setScreen(next);
  };
  const back = () => setScreen("dashboard");
  return (
    <div key={screen} className="flex flex-col gap-4">
      {screen === "dashboard" && (
        <Dashboard d={dashboard ?? dashboardOf(view)} onAsk={onAsk} go={go} />
      )}
      {screen === "plan" &&
        (live ? (
          <LivePlanScreen view={view} onBack={back} onAsk={onAsk} />
        ) : (
          <PlanScreen view={view} onBack={back} onAsk={onAsk} />
        ))}
      {screen === "training" &&
        (live ? (
          <LiveTrainingScreen
            view={view}
            kind={kind}
            sessionId={dashboard?.next?.sessionId ?? null}
            onBack={back}
          />
        ) : (
          <TrainingScreen view={view} kind={kind} onBack={back} />
        ))}
      {screen === "records" && (
        <RecordsScreen
          view={view}
          onBack={back}
          records={live && source ? recordsScreenModel(source.home) : undefined}
        />
      )}
      {screen === "goals" &&
        (live && source ? (
          <LiveGoalsScreen
            view={view}
            source={source}
            onBack={back}
            onRefresh={onRefresh}
          />
        ) : (
          <GoalsScreen view={view} onBack={back} />
        ))}
      {screen === "stats" &&
        (live && source ? (
          <LiveStatsScreen view={view} source={source} onBack={back} />
        ) : (
          <StatsScreen view={view} onBack={back} />
        ))}
      {screen === "health" &&
        (live ? (
          <LiveHealthScreen view={view} onBack={back} onAsk={onAsk} />
        ) : (
          <HealthScreen view={view} onBack={back} />
        ))}
      {screen === "settings" &&
        (live ? (
          <LiveSettingsScreen
            view={view}
            onBack={back}
            onEditProfile={onEditProfile}
          />
        ) : (
          <SettingsScreen
            view={view}
            onBack={back}
            onEditProfile={onEditProfile}
          />
        ))}
    </div>
  );
}
