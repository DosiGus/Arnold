/**
 * Overview: KPIs from the engine, weekly development, recent sessions, records.
 *
 * Nothing here is calculated. Every figure arrives as a `ViewMetric` or a
 * prepared week/record, which is what keeps the dashboard and the analytics
 * engine from ever disagreeing.
 */
import { useState } from "react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Dumbbell,
  Flame,
  ListFilter,
  Target,
  Trophy,
  Weight,
} from "lucide-react";
import type { ArnoldDashboardView } from "../../shared/arnold-view";
import {
  Card,
  EmptyState,
  MetricCard,
  PeriodFilter,
  type PeriodValue,
  RecordRow,
  StatusNotice,
  WorkoutCard,
} from "../components";
import { WeeklyTrendChart, type WeeklyMetric } from "../components/TrendChart";
import { dateLabel } from "../format";

const KPI_STYLE: Record<string, { tone: string; icon: typeof Dumbbell }> = {
  workouts: { tone: "green", icon: Dumbbell },
  training_days: { tone: "blue", icon: CalendarDays },
  training_days_per_week: { tone: "orange", icon: Flame },
  workouts_per_week: { tone: "orange", icon: Activity },
  working_sets: { tone: "purple", icon: ListFilter },
  nominal_volume: { tone: "blue", icon: Weight },
  comparable_volume: { tone: "purple", icon: Weight },
};

const WEEKLY_TABS: { id: WeeklyMetric; label: string }[] = [
  { id: "workouts", label: "Einheiten" },
  { id: "training_days", label: "Trainingstage" },
  { id: "working_sets", label: "Arbeitssätze" },
  { id: "nominal_volume", label: "Volumen" },
];

export function OverviewView({
  view,
  loading = false,
  period = {},
  onPeriodChange = () => {},
  onOpenWorkout,
  onOpenProgress,
}: {
  view: ArnoldDashboardView;
  loading?: boolean;
  period?: PeriodValue;
  onPeriodChange?: (value: PeriodValue) => void;
  onOpenWorkout: (workoutId: string) => void;
  onOpenProgress: () => void;
}) {
  const [weekMetric, setWeekMetric] = useState<WeeklyMetric>("workouts");

  if (view.state === "empty_history" || view.state === "master_template")
    return <FirstRun view={view} />;

  // A tracker with history but no sessions in the selected period is a filter
  // result, not a new tracker. Showing the welcome screen here would claim the
  // user has never trained.
  const emptySelection = view.totals.workouts_in_period === 0;

  return (
    <>
      <div className="filter-bar overview-filters">
        <PeriodFilter
          value={period}
          onChange={onPeriodChange}
          anchor={view.period.to}
          idPrefix="overview"
          scopeLabel="Übersicht"
        />
      </div>
      <div className="overview-meta">
        <span className="section-kicker">
          <span className="live-dot" aria-hidden="true" />
          DEIN TRAINING IN ZAHLEN
        </span>
        <span className="period">
          <CalendarDays size={14} aria-hidden="true" />
          {view.period.from && view.period.to
            ? `${dateLabel(view.period.from)} – ${dateLabel(view.period.to)}`
            : "Noch keine Trainingsdaten"}
        </span>
      </div>

      {emptySelection && (
        <StatusNotice
          notice={{
            code: "filter_empty",
            severity: "info",
            title: "Keine Einheiten im gewählten Zeitraum",
            message:
              "Für diesen Zeitraum liegen keine abgeschlossenen Trainingseinheiten vor. Die Kennzahlen beziehen sich deshalb auf eine leere Auswahl.",
          }}
        />
      )}
      {view.notices.map((notice) => (
        <StatusNotice key={notice.code} notice={notice} />
      ))}

      <div className="stats-grid" aria-busy={loading}>
        {view.kpis.map((metric) => (
          <MetricCard
            key={metric.key}
            metric={metric}
            tone={KPI_STYLE[metric.key]?.tone}
            icon={KPI_STYLE[metric.key]?.icon}
          />
        ))}
      </div>

      <div className="analytics-grid">
        <Card className="volume-card">
          <div className="card-heading">
            <div>
              <h2>Stärker mit jeder Woche.</h2>
              <p>Deine Wochenentwicklung</p>
            </div>
          </div>
          <div
            className="chart-tabs"
            role="group"
            aria-label="Kennzahl der Wochenentwicklung"
          >
            {WEEKLY_TABS.map((tab) => (
              <button
                key={tab.id}
                className={weekMetric === tab.id ? "selected" : ""}
                aria-pressed={weekMetric === tab.id}
                onClick={() => setWeekMetric(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {view.weeks.length ? (
            <WeeklyTrendChart weeks={view.weeks} metric={weekMetric} />
          ) : (
            <EmptyState text="Für den gewählten Zeitraum liegen keine Wochen vor." />
          )}
          <div className="chart-caption">
            <span className="legend-dot" aria-hidden="true" />
            {WEEKLY_TABS.find((t) => t.id === weekMetric)?.label} pro
            Kalenderwoche
            <span>{view.weeks.length} Wochen</span>
          </div>
        </Card>

        <Card className="consistency-card">
          <div className="card-heading">
            <div>
              <h2>Dein Trainingsplan.</h2>
              <p>
                {view.active_plan
                  ? `${view.active_plan.name} · v${view.active_plan.version_no}`
                  : "Kein aktiver Plan"}
              </p>
            </div>
            <span className="soft-icon" aria-hidden="true">
              <Target size={18} />
            </span>
          </div>
          {view.active_plan ? (
            <>
              <dl className="plan-facts">
                <div>
                  <dt>Trainingstage pro Woche</dt>
                  <dd>
                    {view.active_plan.days_per_week ?? "nicht hinterlegt"}
                  </dd>
                </div>
                <div>
                  <dt>Trainingseinheiten im Plan</dt>
                  <dd>{view.active_plan.session_count}</dd>
                </div>
              </dl>
              <ul className="plan-sessions">
                {view.active_plan.sessions.map((session) => (
                  <li key={session.session_id}>
                    <strong>{session.session_name}</strong>
                    <small>{session.exercise_count} Übungen</small>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState
              title="Kein aktiver Trainingsplan"
              text="Deine Einheiten werden weiterhin vollständig ausgewertet."
            />
          )}
          {view.plan_history.length > 1 && (
            <div className="card-note">
              {view.plan_history.length} Planversionen in der Historie; ältere
              Einheiten bleiben ihrer Version zugeordnet.
            </div>
          )}
        </Card>
      </div>

      <div className="bottom-grid">
        <Card className="recent-card">
          <div className="card-heading">
            <div>
              <h2>Zuletzt auf der Trainingsfläche</h2>
              <p>
                {view.period.from || view.period.to
                  ? "Einheiten im gewählten Zeitraum"
                  : "Deine letzten Einheiten auf einen Blick"}
              </p>
            </div>
          </div>
          <div className="workout-list">
            {view.recent_workouts.length ? (
              view.recent_workouts.map((workout) => (
                <WorkoutCard
                  key={workout.workout_id}
                  workout={workout}
                  onSelect={onOpenWorkout}
                />
              ))
            ) : (
              <EmptyState
                text={
                  view.period.from || view.period.to
                    ? "Im gewählten Zeitraum liegen keine Einheiten."
                    : "Noch keine Trainingseinheiten erfasst."
                }
              />
            )}
          </div>
        </Card>

        <Card className="records-card">
          <div className="card-heading">
            <div>
              <h2>Deine Bestleistungen</h2>
              <p>Nur innerhalb vergleichbarer Ausführungen</p>
            </div>
            <span className="trophy-icon" aria-hidden="true">
              <Trophy size={19} />
            </span>
          </div>
          {view.records.length ? (
            view.records
              .slice(0, 5)
              .map((record) => (
                <RecordRow
                  key={`${record.metric}-${record.exercise_id}-${record.achieved_on}`}
                  record={record}
                />
              ))
          ) : (
            <EmptyState text="Sobald du Sätze erfasst, erscheinen hier deine Bestleistungen." />
          )}
          <button className="text-button records-link" onClick={onOpenProgress}>
            Übungsfortschritt ansehen
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </Card>
      </div>
    </>
  );
}

/**
 * First-run and master-template screen.
 *
 * Deliberately has no onboarding button: the onboarding flow does not exist
 * yet, and a button that leads nowhere is worse than none. No example workouts
 * are shown either — invented data here would be indistinguishable from real
 * training once it is on screen.
 */
function FirstRun({ view }: { view: ArnoldDashboardView }) {
  const template = view.state === "master_template";
  return (
    <>
      {view.notices.map((notice) => (
        <StatusNotice key={notice.code} notice={notice} />
      ))}
      <Card className="welcome-card">
        <span className="demo-orbit" aria-hidden="true">
          <Activity size={22} />
        </span>
        <h2>
          {template ? "Arnold · Master-Vorlage" : "Willkommen bei Arnold"}
        </h2>
        <p>
          {template
            ? "Diese Datei ist die gemeinsame Arnold-Vorlage. Sie enthält den Übungskatalog, aber bewusst keine persönlichen Trainingsdaten."
            : "Deine Trainingsdatenbasis ist bereit. Sobald du dein erstes Training erfasst, siehst du hier deine Fortschritte."}
        </p>
        <dl className="plan-facts">
          <div>
            <dt>Übungen im Katalog</dt>
            <dd>{view.exercises.length}</dd>
          </div>
          <div>
            <dt>Erfasste Trainingseinheiten</dt>
            <dd>{view.totals.workouts_in_history}</dd>
          </div>
        </dl>
      </Card>
    </>
  );
}
