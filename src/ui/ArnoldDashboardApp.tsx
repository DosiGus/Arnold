/**
 * Shell of the Arnold v2 dashboard.
 *
 * It keeps the navigation, sidebar and visual language of the existing app and
 * swaps in the views that speak the v2 contract. Its own responsibilities are
 * narrow: which view is on screen, the shared period filter, refreshing, and
 * surfacing whether the data on screen is current.
 */
import { useCallback, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Dumbbell,
  LayoutDashboard,
  Moon,
  RefreshCw,
  Sun,
  TrendingUp,
} from "lucide-react";
import type { ArnoldDashboardView } from "../shared/arnold-view";
import type { ArnoldMcpClient } from "./client/ArnoldMcpClient";
import { useDashboardData } from "./hooks";
import { ErrorState, LoadingState } from "./components";
import { OverviewView } from "./views/OverviewView";
import { WorkoutHistoryView } from "./views/WorkoutHistoryView";
import { ExerciseProgressView } from "./views/ExerciseProgressView";
import { dateTimeLabel } from "./format";

type Screen = "overview" | "history" | "progress";

const NAV = [
  { id: "overview", label: "Übersicht", icon: LayoutDashboard },
  { id: "history", label: "Workouts", icon: Dumbbell },
  { id: "progress", label: "Fortschritt", icon: TrendingUp },
] as const;

const HEADINGS: Record<Screen, { title: string; lead: string }> = {
  overview: {
    title: "Dein Training. Dein Fortschritt.",
    lead: "Kleine Schritte. Messbare Ergebnisse. Alles an einem Ort.",
  },
  history: {
    title: "Jede Einheit zählt.",
    lead: "Deine Trainingshistorie, bis zum letzten Satz.",
  },
  progress: {
    title: "Fortschritt wird sichtbar.",
    lead: "Verstehe deine Entwicklung – Übung für Übung.",
  },
};

export function ArnoldDashboardApp({
  client,
  initial,
  bridgeError,
  stale,
}: {
  client: ArnoldMcpClient;
  initial: ArnoldDashboardView;
  bridgeError: string;
  /** True when the payload came from a replayed result that could not be revalidated. */
  stale: boolean;
}) {
  const [screen, setScreen] = useState<Screen>("overview");
  const [workoutId, setWorkoutId] = useState<string>();
  // The overview is always unfiltered; the views own their own filters, so a
  // filter change never re-initialises the whole app.
  const dashboard = useDashboardData(client, {}, initial);
  const view = dashboard.data ?? initial;

  const go = useCallback((next: Screen, id?: string) => {
    setScreen(next);
    setWorkoutId(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const openWorkout = useCallback((id: string) => go("history", id), [go]);

  return (
    <div className="app-shell read-only">
      <a className="skip-link" href="#main-content">
        Zum Inhalt springen
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
          aria-label="Arnold Startseite"
        >
          <span className="brand-icon">a.</span>
          <span>
            Arnold
            <small>POWERED BY AI</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar" aria-hidden="true">
            <Dumbbell size={17} />
          </span>
          <span>
            Dein Trainingsraum
            <small>{view.source.label}</small>
          </span>
        </div>
        <span className="nav-label">TRAINING</span>
        <nav aria-label="Hauptnavigation">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${screen === item.id ? "active" : ""}`}
              onClick={() => go(item.id)}
              aria-current={screen === item.id ? "page" : undefined}
            >
              <item.icon size={19} aria-hidden="true" />
              <span>{item.label}</span>
              {screen === item.id && (
                <span className="nav-dot" aria-hidden="true" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-card">
            <strong>{view.source.label}</strong>
            <p>{view.source.description}</p>
            <button onClick={dashboard.reload} disabled={dashboard.loading}>
              <RefreshCw
                size={14}
                className={dashboard.loading ? "spin" : ""}
                aria-hidden="true"
              />
              Aktualisieren
            </button>
          </div>
          <div className="profile">
            <span className="profile-avatar" aria-hidden="true">
              DU
            </span>
            <span>
              Dein Trainingsprofil
              <small>
                {view.source.file_role === "MASTER_TEMPLATE"
                  ? "Master-Vorlage · lesend"
                  : "Arnold-Tracker · lesend"}
              </small>
            </span>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div>
            Mein Trainingsraum
            <ChevronRight size={13} aria-hidden="true" />
            <strong>{NAV.find((x) => x.id === screen)?.label}</strong>
          </div>
          <div>
            <span className="demo-pill">
              <span aria-hidden="true" />
              {view.source.label}
            </span>
            <button
              className="icon-button"
              aria-label="Trainingsdaten aktualisieren"
              title="Trainingsdaten aktualisieren"
              disabled={dashboard.loading}
              onClick={dashboard.reload}
            >
              <RefreshCw
                className={dashboard.loading ? "spin" : ""}
                size={15}
                aria-hidden="true"
              />
            </button>
            <button
              className="icon-button"
              aria-label="Farbschema wechseln"
              onClick={() => {
                const root = document.documentElement;
                root.dataset.theme =
                  root.dataset.theme === "dark" ? "light" : "dark";
              }}
            >
              <Sun className="sun-icon" size={18} aria-hidden="true" />
              <Moon className="moon-icon" size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <main id="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                DEIN PERSÖNLICHER TRAININGSÜBERBLICK
              </div>
              <h1>{HEADINGS[screen].title}</h1>
              <p>{HEADINGS[screen].lead}</p>
            </div>
          </div>

          {/* A replayed result that could not be revalidated is labelled, never
              presented as the current state. */}
          {stale && (
            <div className="status-notice warning" role="alert">
              <AlertTriangle size={17} aria-hidden="true" />
              <div>
                <strong>Möglicherweise veraltete Daten</strong>
                <p>
                  Diese Ansicht stammt aus einem früheren Tool-Ergebnis und
                  konnte nicht gegen den Server geprüft werden. Stand:{" "}
                  {dateTimeLabel(view.source.generated_at)}.
                </p>
                <button className="secondary" onClick={dashboard.reload}>
                  <RefreshCw size={14} aria-hidden="true" />
                  Jetzt aktualisieren
                </button>
              </div>
            </div>
          )}

          <div className="source-note">
            <strong>{view.source.label}</strong>
            <span>{view.source.description}</span>
            <small>
              Zuletzt geladen: {dateTimeLabel(view.source.generated_at)} ·
              Schema {view.source.schema_version} · Kennzahlen{" "}
              {view.source.metrics_version}
            </small>
          </div>

          {bridgeError && <ErrorState message={bridgeError} />}
          {dashboard.error && (
            <ErrorState message={dashboard.error} onRetry={dashboard.reload} />
          )}

          {dashboard.loading && !dashboard.data ? (
            <LoadingState text="Trainingsüberblick wird geladen …" />
          ) : (
            <>
              {screen === "overview" && (
                <OverviewView
                  view={view}
                  onOpenWorkout={openWorkout}
                  onOpenProgress={() => go("progress")}
                />
              )}
              {screen === "history" && (
                <WorkoutHistoryView
                  client={client}
                  dashboard={view}
                  initialWorkoutId={workoutId}
                />
              )}
              {screen === "progress" && (
                <ExerciseProgressView client={client} dashboard={view} />
              )}
            </>
          )}

          <footer>
            <span>
              <span className="online-dot" aria-hidden="true" />
              {client.embedded
                ? "Mit MCP-Host verbunden"
                : "Mit lokalem MCP-Server verbunden"}
            </span>
            <span>
              Arnold <span className="footer-separator">/</span> Dein
              Fortschritt beginnt hier.
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
