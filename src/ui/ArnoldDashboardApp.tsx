import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChartNoAxesCombined,
  History,
  Layers2,
  Moon,
  Orbit,
  Play,
  RefreshCw,
  Sun,
} from "lucide-react";
import type { ArnoldDashboardView } from "../shared/arnold-view";
import type { ArnoldMcpClient } from "./client/ArnoldMcpClient";
import { useDashboardData } from "./hooks";
import { ErrorState, LoadingState } from "./components";
import { OverviewView } from "./views/OverviewView";
import { WorkoutHistoryView } from "./views/WorkoutHistoryView";
import { ExerciseProgressView } from "./views/ExerciseProgressView";
import { WorkoutLoggerView } from "./views/WorkoutLoggerView";
import { TrainingPlanEditorView } from "./views/TrainingPlanEditorView";
import { dateLabel, dateTimeLabel } from "./format";

type Screen = "overview" | "training" | "plan" | "progress" | "history";
const NAV = [
  { id: "overview", label: "Überblick", icon: Orbit },
  { id: "training", label: "Training", icon: Play },
  { id: "plan", label: "Plan", icon: Layers2 },
  { id: "progress", label: "Fortschritt", icon: ChartNoAxesCombined },
  { id: "history", label: "Verlauf", icon: History },
] as const;
const HEADINGS: Record<Screen, string> = {
  overview: "Dein Überblick.",
  training: "Dein Training.",
  plan: "Dein Plan.",
  progress: "Dein Fortschritt.",
  history: "Deine Trainings.",
};
function initialScreen(): Screen {
  if (typeof window === "undefined") return "overview";
  const requested = new URLSearchParams(window.location.search).get("view");
  return NAV.find((item) => item.id === requested)?.id ?? "overview";
}

export function ArnoldDashboardApp({
  client,
  initial,
  bridgeError,
  stale,
}: {
  client: ArnoldMcpClient;
  initial: ArnoldDashboardView;
  bridgeError: string;
  stale: boolean;
}) {
  const [canWrite, setCanWrite] = useState(false);
  const [hasPlans, setHasPlans] = useState(false);
  useEffect(() => {
    let active = true;
    void client
      .workout()
      .then((context) => {
        if (active) setCanWrite(context.can_write);
      })
      .catch(() => {});
    void client
      .planContext()
      .then(() => {
        if (active) setHasPlans(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [workoutId, setWorkoutId] = useState<string>();
  const dashboard = useDashboardData(client, {}, initial);
  // A fresh host push must still win over an older local response.
  const view = useMemo(() => {
    const loaded = dashboard.data;
    if (!loaded) return initial;
    return initial.source.generated_at > loaded.source.generated_at
      ? initial
      : loaded;
  }, [dashboard.data, initial]);
  const showStale = stale && view === initial;
  // The current presenter marks legacy fixtures as read-only Sheets. Keep their
  // explicit fixture label visible as a demo instead of implying a real account.
  const isDemo =
    view.source.synthetic || /(?:^|[\s·-])fixture\b/i.test(view.source.label);
  const go = useCallback((next: Screen, id?: string) => {
    setScreen(next);
    setWorkoutId(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const openWorkout = useCallback((id: string) => go("history", id), [go]);

  return (
    <div className="app-shell glass-app">
      <a className="skip-link" href="#main-content">
        Zum Inhalt springen
      </a>
      <div className="app-chrome">
        <header className="app-header">
          <a
            className="brand"
            href="#"
            aria-label="Arnold Startseite"
            onClick={(event) => {
              event.preventDefault();
              go("overview");
            }}
          >
            <Orbit size={25} strokeWidth={1.25} aria-hidden="true" />
            <span>arnold</span>
          </a>
          <nav className="app-nav" aria-label="Hauptnavigation">
            {NAV.filter(
              (item) =>
                (item.id !== "training" || canWrite) &&
                (item.id !== "plan" || hasPlans),
            ).map((item) => (
              <button
                key={item.id}
                className={`nav-item ${screen === item.id ? "active" : ""}`}
                onClick={() => go(item.id)}
                aria-current={screen === item.id ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
              >
                <item.icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="header-actions">
            {isDemo ? (
              <span className="source-badge" title="Synthetische Beispieldaten">
                Demo
              </span>
            ) : view.source.file_role === "MASTER_TEMPLATE" ? (
              <span className="source-badge">Vorlage</span>
            ) : view.source.read_only && !canWrite ? (
              <span className="source-badge">Nur Ansicht</span>
            ) : null}
            <button
              className="icon-button"
              aria-label="Trainingsdaten aktualisieren"
              title="Aktualisieren"
              disabled={dashboard.loading}
              onClick={dashboard.reload}
            >
              <RefreshCw
                className={dashboard.loading ? "spin" : ""}
                size={16}
                aria-hidden="true"
              />
            </button>
            <button
              className="icon-button"
              aria-label="Farbschema wechseln"
              title="Hell / Dunkel"
              onClick={() => {
                const root = document.documentElement;
                root.dataset.theme =
                  root.dataset.theme === "dark" ? "light" : "dark";
              }}
            >
              <Sun className="sun-icon" size={17} aria-hidden="true" />
              <Moon className="moon-icon" size={17} aria-hidden="true" />
            </button>
          </div>
        </header>
      </div>
      <main id="main-content">
        <div className="page-heading">
          <h1>{HEADINGS[screen]}</h1>
          {screen === "overview" && (
            <span className="heading-period">
              {view.period.from && view.period.to
                ? `${dateLabel(view.period.from)} — ${dateLabel(view.period.to)}`
                : "Gesamter Verlauf"}
            </span>
          )}
        </div>
        {showStale && (
          <div className="status-notice warning" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <div>
              <strong>Möglicherweise veraltete Daten</strong>
              <p>Stand: {dateTimeLabel(view.source.generated_at)}.</p>
              <button className="secondary" onClick={dashboard.reload}>
                Jetzt aktualisieren
              </button>
            </div>
          </div>
        )}
        {bridgeError && <ErrorState message={bridgeError} />}
        {dashboard.error && (
          <ErrorState message={dashboard.error} onRetry={dashboard.reload} />
        )}
        {dashboard.loading && !dashboard.data ? (
          <LoadingState />
        ) : (
          <>
            {screen === "overview" && (
              <OverviewView
                view={view}
                loading={dashboard.loading}
                onOpenWorkout={openWorkout}
                onOpenProgress={() => go("progress")}
                onOpenTraining={canWrite ? () => go("training") : undefined}
                onOpenPlan={hasPlans ? () => go("plan") : undefined}
              />
            )}
            {screen === "history" && (
              <WorkoutHistoryView
                client={client}
                dashboard={view}
                initialWorkoutId={workoutId}
              />
            )}
            {screen === "training" && (
              <WorkoutLoggerView client={client} onChanged={dashboard.reload} />
            )}
            {screen === "plan" && (
              <TrainingPlanEditorView
                client={client}
                onChanged={dashboard.reload}
              />
            )}
            {screen === "progress" && (
              <ExerciseProgressView client={client} dashboard={view} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
