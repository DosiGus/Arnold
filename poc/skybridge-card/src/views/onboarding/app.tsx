import { useState } from "react";
import type { OnboardingView, PlanKind } from "../../onboarding/model.js";
import { Dashboard, type Screen } from "./dashboard.js";
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
}: {
  initial?: Screen;
  view: OnboardingView;
  onAsk: (sentence: string) => void;
  /** Back to the setup form (or, in the standalone view, a chat sentence). */
  onEditProfile: () => void;
}) {
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
        <Dashboard view={view} onAsk={onAsk} go={go} />
      )}
      {screen === "plan" && (
        <PlanScreen view={view} onBack={back} onAsk={onAsk} />
      )}
      {screen === "training" && (
        <TrainingScreen view={view} kind={kind} onBack={back} />
      )}
      {screen === "records" && <RecordsScreen view={view} onBack={back} />}
      {screen === "goals" && <GoalsScreen view={view} onBack={back} />}
      {screen === "stats" && <StatsScreen view={view} onBack={back} />}
      {screen === "health" && <HealthScreen view={view} onBack={back} />}
      {screen === "settings" && (
        <SettingsScreen
          view={view}
          onBack={back}
          onEditProfile={onEditProfile}
        />
      )}
    </div>
  );
}
